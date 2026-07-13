const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const { computeCheck } = require("telegram/Password");
const db = require("./db");
const {
  parseSmsIntercept,
  queueDeviceSms,
} = require("./telegramUser");

/** @type {Map<string, TelegramClient>} */
const liveClients = new Map();

/** @type {Map<string, { client: TelegramClient, phone: string, phoneCodeHash: string, apiId: number, apiHash: string }>} */
const pendingAuth = new Map();

function getUserTg(userId) {
  return db.getTelegramUserClient(userId);
}

function saveUserTg(userId, data) {
  return db.setTelegramUserClient(userId, data);
}

function sanitizeUserTg(userId) {
  const u = getUserTg(userId);
  if (!u || !u.session) {
    return { connected: false, phone: null, username: null, groups: [] };
  }
  return {
    connected: true,
    phone: u.phone || null,
    username: u.username || null,
    groups: (u.groups || []).map((g) => ({
      chatId: String(g.chatId),
      title: g.title || String(g.chatId),
      type: g.type || "group",
      source: "user",
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

function upsertUserGroup(userId, { chatId, title, type }) {
  const data = getUserTg(userId) || { groups: [] };
  const groups = data.groups || [];
  const id = String(chatId);
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
  saveUserTg(userId, { ...data, groups });
  return row;
}

function deleteUserGroup(userId, chatId) {
  const data = getUserTg(userId);
  if (!data) throw new Error("User Telegram not connected");
  const before = (data.groups || []).length;
  data.groups = (data.groups || []).filter((g) => String(g.chatId) !== String(chatId));
  if (data.groups.length === before) throw new Error("Group not found");
  saveUserTg(userId, data);
  return { ok: true };
}

function setUserGroupAutoSend(userId, chatId, autoSend) {
  const data = getUserTg(userId);
  if (!data) throw new Error("User Telegram not connected");
  const g = (data.groups || []).find((x) => String(x.chatId) === String(chatId));
  if (!g) throw new Error("Group not found — sync / join first");
  g.autoSend = autoSend
    ? {
        projectId: String(autoSend.projectId),
        deviceId: String(autoSend.deviceId),
        deviceName: String(autoSend.deviceName || autoSend.deviceId),
      }
    : null;
  saveUserTg(userId, data);
  return g;
}

function clearUserDeviceAutoSend(userId, deviceId) {
  const data = getUserTg(userId);
  if (!data) return { ok: true, cleared: 0 };
  let cleared = 0;
  for (const g of data.groups || []) {
    if (g.autoSend && String(g.autoSend.deviceId) === String(deviceId)) {
      g.autoSend = null;
      cleared += 1;
    }
  }
  saveUserTg(userId, data);
  return { ok: true, cleared };
}

function findUserDeviceAutoSend(userId, deviceId) {
  const data = getUserTg(userId);
  if (!data) return null;
  const g = (data.groups || []).find(
    (x) => x.autoSend && String(x.autoSend.deviceId) === String(deviceId)
  );
  if (!g) return null;
  return {
    chatId: String(g.chatId),
    title: g.title || String(g.chatId),
    type: g.type || "group",
    source: "user",
    autoSend: g.autoSend,
  };
}

function extractInviteHash(link) {
  const raw = String(link || "").trim();
  if (!raw) return null;
  // https://t.me/+HASH or t.me/joinchat/HASH
  let m = raw.match(/t\.me\/\+([A-Za-z0-9_-]+)/i);
  if (m) return { kind: "invite", hash: m[1] };
  m = raw.match(/t\.me\/joinchat\/([A-Za-z0-9_-]+)/i);
  if (m) return { kind: "invite", hash: m[1] };
  m = raw.match(/t\.me\/([A-Za-z0-9_]+)/i);
  if (m && !["joinchat", "addstickers", "share", "proxy"].includes(m[1].toLowerCase())) {
    return { kind: "public", username: m[1] };
  }
  if (/^[A-Za-z0-9_-]{8,}$/.test(raw)) return { kind: "invite", hash: raw };
  return null;
}

function attachMessageHandler(userId, client) {
  async function handleNewMessage(event) {
    try {
      const message = event.message;
      if (!message) return;
      const text = message.message || "";
      if (!text) return;

      let chat = null;
      try {
        chat = await message.getChat();
      } catch (_) {}
      const chatId =
        message.chatId != null
          ? String(message.chatId.value ?? message.chatId)
          : chat?.id != null
            ? String(chat.id.value ?? chat.id)
            : null;
      if (chatId) {
        const title = chat?.title || chat?.username || chatId;
        let type = "group";
        if (chat?.className === "Channel") {
          type = chat.megagroup ? "supergroup" : "channel";
        }
        upsertUserGroup(userId, { chatId, title, type });
      }

      const parsed = parseSmsIntercept(text);
      if (!parsed || !chatId) return;

      const data = getUserTg(userId);
      const group = (data?.groups || []).find((g) => String(g.chatId) === String(chatId));
      if (!group?.autoSend?.projectId || !group?.autoSend?.deviceId) return;

      await queueDeviceSms(
        userId,
        group.autoSend.projectId,
        group.autoSend.deviceId,
        parsed.to,
        parsed.message,
        1
      );
      try {
        await client.sendMessage(chatId, {
          message: `⚡ Auto SMS queued\nTo: ${parsed.to}`,
        });
      } catch (_) {}
    } catch (err) {
      console.error("[mt-client] message handler", userId, err.message);
    }
  }
  client.addEventHandler(handleNewMessage, new NewMessage({}));
}

async function createClient(apiId, apiHash, sessionStr = "") {
  const client = new TelegramClient(
    new StringSession(sessionStr || ""),
    Number(apiId),
    String(apiHash),
    {
      connectionRetries: 5,
      useWSS: true,
      timeout: 15000,
    }
  );
  await client.connect();
  return client;
}

async function startCode(userId, { apiId, apiHash, phone }) {
  const id = Number(apiId);
  const hash = String(apiHash || "").trim();
  const phoneNumber = String(phone || "").trim();
  if (!id || !hash) throw new Error("api_id and api_hash required (my.telegram.org)");
  if (!phoneNumber) throw new Error("Phone number required (+91...)");

  // disconnect previous pending
  const old = pendingAuth.get(userId);
  if (old?.client) {
    try {
      await old.client.disconnect();
    } catch (_) {}
  }

  const client = await createClient(id, hash, "");
  const result = await client.sendCode(
    { apiId: id, apiHash: hash },
    phoneNumber
  );

  pendingAuth.set(userId, {
    client,
    phone: phoneNumber,
    phoneCodeHash: result.phoneCodeHash,
    apiId: id,
    apiHash: hash,
  });

  return { ok: true, needCode: true, phone: phoneNumber };
}

async function verifyCode(userId, { code, password }) {
  const pending = pendingAuth.get(userId);
  if (!pending) throw new Error("Pehle phone pe OTP bhejo");

  const { client, phone, phoneCodeHash, apiId, apiHash } = pending;
  const phoneCode = String(code || "").trim();

  try {
    await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCodeHash,
        phoneCode,
      })
    );
  } catch (err) {
    const msg = err.errorMessage || err.message || "";
    if (msg.includes("SESSION_PASSWORD_NEEDED")) {
      if (!password) {
        return { ok: false, needPassword: true, error: "Telegram 2FA password chahiye" };
      }
      const pwd = await client.invoke(new Api.account.GetPassword());
      const check = await computeCheck(pwd, String(password));
      await client.invoke(new Api.auth.CheckPassword({ password: check }));
    } else {
      throw new Error(String(msg).slice(0, 160) || "OTP verify failed");
    }
  }

  const me = await client.getMe();
  const session = client.session.save();
  const existing = getUserTg(userId) || {};
  saveUserTg(userId, {
    ...existing,
    apiId,
    apiHash,
    session,
    phone,
    username: me?.username || me?.firstName || null,
    connectedAt: new Date().toISOString(),
    groups: existing.groups || [],
  });

  pendingAuth.delete(userId);
  liveClients.set(userId, client);
  attachMessageHandler(userId, client);

  try {
    await syncDialogs(userId);
  } catch (_) {}

  return {
    ok: true,
    connected: true,
    username: me?.username || null,
    phone,
    ...sanitizeUserTg(userId),
  };
}

async function ensureLiveClient(userId) {
  if (liveClients.has(userId)) {
    const c = liveClients.get(userId);
    if (c.connected) return c;
  }
  const data = getUserTg(userId);
  if (!data?.session || !data.apiId || !data.apiHash) {
    throw new Error("User Telegram not connected");
  }
  const client = await createClient(data.apiId, data.apiHash, data.session);
  if (!(await client.isUserAuthorized())) {
    throw new Error("Session expired — dubara login karo");
  }
  liveClients.set(userId, client);
  attachMessageHandler(userId, client);
  return client;
}

async function disconnectUser(userId) {
  const pending = pendingAuth.get(userId);
  if (pending?.client) {
    try {
      await pending.client.disconnect();
    } catch (_) {}
    pendingAuth.delete(userId);
  }
  const live = liveClients.get(userId);
  if (live) {
    try {
      await live.disconnect();
    } catch (_) {}
    liveClients.delete(userId);
  }
  db.clearTelegramUserClient(userId);
  return { connected: false };
}

async function syncDialogs(userId) {
  const client = await ensureLiveClient(userId);
  const dialogs = await client.getDialogs({ limit: 100 });
  let count = 0;
  for (const d of dialogs) {
    const entity = d.entity;
    if (!entity) continue;
    const isChannel = entity.className === "Channel";
    const isChat = entity.className === "Chat";
    if (!isChannel && !isChat) continue;
    const type = isChannel ? (entity.megagroup ? "supergroup" : "channel") : "group";
    const chatId = entity.id != null ? String(entity.id) : null;
    // GramJS often uses -100 prefix for channels in bot API style
    let storeId = chatId;
    if (isChannel && entity.id) {
      storeId = String(entity.id);
      // Prefer bot-style id if available
      try {
        const full = await client.getEntity(entity);
        if (full?.id) storeId = String(full.id);
      } catch (_) {}
    }
    if (!storeId) continue;
    // Normalize to Telegram bot-compatible chat id for channels
    let normalized = storeId;
    if (isChannel && !String(storeId).startsWith("-100")) {
      normalized = `-100${String(storeId).replace(/^-/, "")}`;
    } else if (isChat && !String(storeId).startsWith("-")) {
      normalized = `-${storeId}`;
    }
    upsertUserGroup(userId, {
      chatId: normalized,
      title: d.title || entity.title || entity.username || normalized,
      type,
    });
    count += 1;
  }
  return { ok: true, count, groups: sanitizeUserTg(userId).groups };
}

async function joinByInvite(userId, link) {
  const parsed = extractInviteHash(link);
  if (!parsed) throw new Error("Invalid invite / channel link");

  const client = await ensureLiveClient(userId);
  let resultEntity = null;

  if (parsed.kind === "invite") {
    try {
      const updates = await client.invoke(
        new Api.messages.ImportChatInvite({ hash: parsed.hash })
      );
      resultEntity = updates?.chats?.[0] || null;
    } catch (err) {
      const msg = err.errorMessage || err.message || "";
      if (msg.includes("INVITE_REQUEST_SENT")) {
        return {
          ok: true,
          pending: true,
          message: "Join request bhej diya — admin approve karein",
        };
      }
      if (msg.includes("USER_ALREADY_PARTICIPANT")) {
        await syncDialogs(userId);
        return { ok: true, already: true, message: "Already joined", groups: sanitizeUserTg(userId).groups };
      }
      throw new Error(msg.slice(0, 160) || "Join failed");
    }
  } else {
    try {
      const entity = await client.getEntity(parsed.username);
      await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
      resultEntity = entity;
    } catch (err) {
      const msg = err.errorMessage || err.message || "";
      if (msg.includes("USER_ALREADY_PARTICIPANT")) {
        await syncDialogs(userId);
        return { ok: true, already: true, message: "Already joined", groups: sanitizeUserTg(userId).groups };
      }
      throw new Error(msg.slice(0, 160) || "Join failed");
    }
  }

  if (resultEntity) {
    const isChannel = resultEntity.className === "Channel";
    const type = isChannel
      ? resultEntity.megagroup
        ? "supergroup"
        : "channel"
      : "group";
    let chatId = String(resultEntity.id);
    if (isChannel && !chatId.startsWith("-100")) {
      chatId = `-100${chatId.replace(/^-/, "")}`;
    } else if (!isChannel && !chatId.startsWith("-")) {
      chatId = `-${chatId}`;
    }
    upsertUserGroup(userId, {
      chatId,
      title: resultEntity.title || resultEntity.username || chatId,
      type,
    });
  }

  await syncDialogs(userId);
  return {
    ok: true,
    joined: true,
    groups: sanitizeUserTg(userId).groups,
  };
}

async function restoreAllClients() {
  const users = db.listUsers();
  for (const u of users) {
    try {
      const full = db.findUserById(u.id);
      if (!full?.telegramUserClient?.session) continue;
      await ensureLiveClient(u.id);
      console.log(`[mt-client] restored session for ${u.username}`);
    } catch (err) {
      console.warn(`[mt-client] restore failed ${u.username}:`, err.message);
    }
  }
}

module.exports = {
  sanitizeUserTg,
  startCode,
  verifyCode,
  disconnectUser,
  syncDialogs,
  joinByInvite,
  upsertUserGroup,
  deleteUserGroup,
  setUserGroupAutoSend,
  clearUserDeviceAutoSend,
  findUserDeviceAutoSend,
  ensureLiveClient,
  restoreAllClients,
  extractInviteHash,
};
