const fetch = require("node-fetch");

const pendingCodes = new Map();

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Telegram bot not configured");
  if (!chatId) throw new Error("Telegram chat ID not set for this user");

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram send failed: ${err.slice(0, 100)}`);
  }
}

function formatDeviceBlock(meta = {}) {
  const lines = [];
  if (meta.deviceId) lines.push(`Device ID: <code>${escHtml(meta.deviceId)}</code>`);
  if (meta.deviceName) lines.push(`Device: <b>${escHtml(meta.deviceName)}</b>`);
  if (meta.model) lines.push(`Model: <code>${escHtml(meta.model)}</code>`);
  if (meta.client) lines.push(`Client: <code>${escHtml(meta.client)}</code>`);
  return lines.length ? "\n" + lines.join("\n") : "";
}

async function send2FACode(username, chatId, meta = {}) {
  const code = generateCode();
  const sessionId = `${username}_${Date.now()}`;
  pendingCodes.set(sessionId, {
    code,
    username,
    meta,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  await sendTelegramMessage(
    chatId,
    `🔐 <b>DARK PANEL Login OTP</b>\n\n` +
      `User: <code>${escHtml(username)}</code>` +
      formatDeviceBlock(meta) +
      `\n\nOTP: <b>${code}</b>\nValid 5 minutes.`
  );
  return sessionId;
}

async function sendLoginAlert(username, chatId, meta = {}) {
  if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) return;
  try {
    await sendTelegramMessage(
      chatId,
      `✅ <b>DARK PANEL Login Success</b>\n\n` +
        `User: <code>${escHtml(username)}</code>` +
        formatDeviceBlock(meta) +
        `\n\nTime: ${new Date().toLocaleString("en-IN")}`
    );
  } catch (_) {
    /* never fail login if alert fails */
  }
}

function verify2FACode(sessionId, code) {
  const entry = pendingCodes.get(sessionId);
  if (!entry) return { ok: false, error: "Session expired" };
  if (Date.now() > entry.expiresAt) {
    pendingCodes.delete(sessionId);
    return { ok: false, error: "Code expired" };
  }
  if (entry.code !== code.trim()) {
    return { ok: false, error: "Invalid code" };
  }
  pendingCodes.delete(sessionId);
  return { ok: true, username: entry.username, meta: entry.meta || {} };
}

function isGlobal2FAEnabled() {
  return process.env.TELEGRAM_2FA_ENABLED === "true";
}

function getAlertChatId(user) {
  return (user && user.telegramChatId) || process.env.TELEGRAM_CHAT_ID || null;
}

module.exports = {
  send2FACode,
  verify2FACode,
  isGlobal2FAEnabled,
  sendTelegramMessage,
  sendLoginAlert,
  getAlertChatId,
};
