require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { firebaseGet, firebasePut, firebaseDelete, testConnection } = require("./firebase");
const { createToken, authMiddleware } = require("./auth");
const { send2FACode, verify2FACode, isGlobal2FAEnabled } = require("./telegram");
const { adminMiddleware } = require("./admin");
const db = require("./db");

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

    const needs2FA = user.twoFactorEnabled || isGlobal2FAEnabled();
    if (needs2FA) {
      const chatId = user.telegramChatId || process.env.TELEGRAM_CHAT_ID;
      if (!chatId) {
        return res.status(400).json({ error: "2FA enabled but Telegram chat ID not configured" });
      }
      const sessionId = await send2FACode(user.username, chatId);
      return res.json({ requires2FA: true, sessionId, username: user.username });
    }

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

app.post("/api/auth/verify-2fa", (req, res) => {
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
  const token = createToken(user);
  res.json({
    token,
    username: user.username,
    userId: user.id,
    firebaseProjects: db.getFirebaseProjects(user.id),
  });
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  const user = db.findUserById(req.user.sub);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({
    username: user.username,
    userId: user.id,
    firebaseProjects: db.getFirebaseProjects(user.id),
  });
});

// ─── Firebase Projects (per user) ───────────────────────────
app.get("/api/firebase-projects", authMiddleware, (req, res) => {
  try {
    const projects = db.getFirebaseProjects(req.user.sub);
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/firebase-projects", authMiddleware, async (req, res) => {
  try {
    const { name, firebaseUrl, firebaseSecret } = req.body || {};
    const project = db.addFirebaseProject(req.user.sub, { name, firebaseUrl, firebaseSecret });
    await testConnection(
      db.getFirebaseProject(req.user.sub, project.id).firebaseUrl,
      db.getFirebaseProject(req.user.sub, project.id).firebaseSecret
    );
    res.status(201).json({ ok: true, project });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/firebase-projects/:projectId", authMiddleware, async (req, res) => {
  try {
    const project = db.updateFirebaseProject(req.user.sub, req.params.projectId, req.body || {});
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
      } catch {
        messages[id] = null;
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

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`DARK PANEL API running on port ${port}`);
  console.log(`Admin key: ${process.env.ADMIN_KEY ? "SET" : "NOT SET — set ADMIN_KEY in .env"}`);
  console.log(`Global 2FA: ${isGlobal2FAEnabled() ? "ON" : "OFF"}`);
});
