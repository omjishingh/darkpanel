const fetch = require("node-fetch");

const pendingCodes = new Map();

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
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

async function send2FACode(username, chatId) {
  const code = generateCode();
  const sessionId = `${username}_${Date.now()}`;
  pendingCodes.set(sessionId, {
    code,
    username,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  await sendTelegramMessage(
    chatId,
    `🔐 <b>DARK PANEL Login</b>\n\nUser: <code>${username}</code>\nOTP: <b>${code}</b>\n\nValid 5 minutes.`
  );
  return sessionId;
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
  return { ok: true, username: entry.username };
}

function isGlobal2FAEnabled() {
  return process.env.TELEGRAM_2FA_ENABLED === "true";
}

module.exports = { send2FACode, verify2FACode, isGlobal2FAEnabled, sendTelegramMessage };
