require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { firebaseGet, firebasePut, firebasePatch, firebaseDelete, testConnection } = require("./firebase");
const { createToken, authMiddleware, requireOwner, requireKeyPerm, requireServerAdmin, isServerAdminUser } = require("./auth");
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
const telegramMt = require("./telegramMtClient");
const serverHub = require("./serverHub");

const EXPIRES_IN_MS = {
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

function isWebClient(req) {
  return String(req.headers["x-client"] || "").toLowerCase() === "web";
}

function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (xf) return String(xf).split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || null;
}

function sessionMetaFromReq(req, body = {}) {
  const meta = extractLoginMeta(body, req);
  return {
    ...meta,
    ip: clientIp(req),
    userAgent: String(req.headers["user-agent"] || body.userAgent || "").slice(0, 256) || null,
  };
}

function logGuestActivity(req, action, detail) {
  if (req.user?.scope !== "guest" || !req.user.keyId) return;
  try {
    if (!db.MAIN_KEY_ACTIONS.has(String(action))) return;
    db.logKeyActivity(req.user.sub, req.user.keyId, {
      action,
      detail,
      client: String(req.headers["x-client"] || req.user.client || "guest").slice(0, 64),
      ip: clientIp(req),
    });
  } catch (_) {}
}

/** Block guests from security/telegram/firebase mutations and 2FA profile edits */
function guestRestrictions(req, res, next) {
  if (req.user?.scope !== "guest") return next();

  const method = req.method.toUpperCase();
  const path = req.path || "";

  if (path === "/api/auth/logout" || path === "/api/security/my-activity") {
    return next();
  }
  if (path === "/api/auth/me" && method === "GET") return next();
  if (path === "/api/auth/theme" && method === "PATCH") {
    return res.status(403).json({ error: "Guests cannot change theme" });
  }
  if (path === "/api/auth/change-password") {
    return res.status(403).json({ error: "Guests cannot change password" });
  }
  if (path === "/api/auth/me" && method === "PATCH") {
    return res.status(403).json({ error: "Guests cannot update account settings" });
  }
  if (path.startsWith("/api/security/")) {
    return res.status(403).json({ error: "Owner access required" });
  }
  if (path.startsWith("/api/server/")) {
    return res.status(403).json({ error: "Owner access required" });
  }
  if (path.startsWith("/api/telegram/")) {
    return res.status(403).json({ error: "Guests cannot access Telegram settings" });
  }
  if (
    path.startsWith("/api/firebase-projects") &&
    (method === "POST" || method === "PUT" || method === "DELETE")
  ) {
    return res.status(403).json({ error: "Guests cannot modify Firebase projects" });
  }
  return next();
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
  const info = db.getDbInfo();
  res.json({
    ok: true,
    global2FA: isGlobal2FAEnabled(),
    users: info.users,
    dataPath: info.path,
    dataWarning: info.warning,
    serverHub: serverHub.isEnabled(),
  });
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

app.get("/api/admin/backup", adminMiddleware, (_, res) => {
  try {
    const data = db.exportDb();
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="darkpanel-backup-${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.send(JSON.stringify(data, null, 2));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/restore", adminMiddleware, (req, res) => {
  try {
    const payload = req.body?.users ? req.body : req.body?.data;
    if (!payload) return res.status(400).json({ error: "JSON body with users required" });
    const info = db.importDb(payload.users ? payload : { users: payload });
    res.json({ ok: true, ...info });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/admin/db-info", adminMiddleware, (_, res) => {
  res.json(db.getDbInfo());
});

// ─── Server Hub (VPS deploy manager) ─────────────────────────
app.get("/api/server/enabled", (_, res) => {
  res.json({
    enabled: serverHub.isEnabled(),
    serverAdmin: serverHub.getServerAdminUsername(),
  });
});

app.get("/api/server/apps", authMiddleware, requireServerAdmin, async (_, res) => {
  try {
    res.json(await serverHub.getAppsStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/server/apps", authMiddleware, requireServerAdmin, (req, res) => {
  try {
    const app = serverHub.addApp(req.body || {});
    res.status(201).json({ ok: true, app });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/server/apps/:appId", authMiddleware, requireServerAdmin, (req, res) => {
  try {
    res.json(serverHub.deleteApp(req.params.appId));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/server/deploy/:appId", authMiddleware, requireServerAdmin, async (req, res) => {
  try {
    const log = await serverHub.deployApp(req.params.appId, { trigger: "manual" });
    res.json({ ok: true, log });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/server/:action/:appId", authMiddleware, requireServerAdmin, async (req, res) => {
  const { action, appId } = req.params;
  if (!["restart", "stop", "start"].includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }
  try {
    res.json(await serverHub.pm2Action(appId, action));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/server/logs/:appId", authMiddleware, requireServerAdmin, async (req, res) => {
  try {
    res.json(await serverHub.getAppLogs(req.params.appId, req.query.lines));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GitHub auto-deploy webhook (like Render)
app.post("/api/deploy/webhook/:appId", async (req, res) => {
  try {
    const secret = req.query.secret || req.headers["x-hub-signature-256"];
    const app = serverHub.verifyWebhook(req.params.appId, req.query.secret);
    const check = serverHub.handleGithubPush(req.body || {}, app);
    if (check.skipped) {
      return res.json({ ok: true, skipped: true, reason: check.reason });
    }
    const log = await serverHub.deployApp(app.id, {
      trigger: "github",
      commit: check.commit,
    });
    res.json({ ok: true, deployed: true, log });
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
    const sessionMeta = sessionMetaFromReq(req, req.body);
    const session = db.createSession(user.id, sessionMeta);
    const token = createToken(user, { sid: session.id, scope: "owner" });
    return res.json({
      token,
      sessionId: session.id,
      username: user.username,
      userId: user.id,
      firebaseProjects: db.getFirebaseProjects(user.id),
      serverHub: serverHub.isEnabled(),
      serverAdmin: isServerAdminUser(user.username),
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
    const sessionMeta = sessionMetaFromReq(req, req.body);
    const session = db.createSession(user.id, sessionMeta);
    const token = createToken(user, { sid: session.id, scope: "owner" });
    res.json({
      token,
      sessionId: session.id,
      username: user.username,
      userId: user.id,
      firebaseProjects: db.getFirebaseProjects(user.id),
      serverHub: serverHub.isEnabled(),
      serverAdmin: isServerAdminUser(user.username),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "2FA verify failed" });
  }
});

app.post("/api/auth/login-key", async (req, res) => {
  try {
    const { key, client, deviceId, model } = req.body || {};
    if (!key) return res.status(400).json({ error: "key required" });
    const found = db.findAccessKeyByRaw(key);
    if (!found) {
      return res.status(401).json({ error: "Invalid or expired access key" });
    }
    const { user, key: accessKey } = found;
    const sessionMeta = {
      ...sessionMetaFromReq(req, { client, deviceId, model }),
      label: `Guest: ${accessKey.label}`,
      keyId: accessKey.id,
    };
    const session = db.createSession(user.id, sessionMeta);
    db.markAccessKeyUsed(user.id, accessKey.id);
    db.logKeyActivity(user.id, accessKey.id, {
      action: "login",
      detail: `Login on ${sessionMeta.client || "web"}${sessionMeta.ip ? ` · IP ${sessionMeta.ip}` : ""}`,
      client: sessionMeta.client,
      ip: sessionMeta.ip,
    });
    const permissions = db.normalizePermissions(accessKey.permissions);
    const token = createToken(
      { id: user.id, username: user.username },
      {
        sid: session.id,
        guestSid: session.id,
        scope: "guest",
        keyId: accessKey.id,
        ownerId: user.id,
      }
    );
    res.json({
      token,
      sessionId: session.id,
      scope: "guest",
      keyId: accessKey.id,
      keyLabel: accessKey.label,
      permissions,
      username: user.username,
      userId: user.id,
      firebaseProjects: db.getFirebaseProjects(user.id),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Key login failed" });
  }
});

app.get("/api/auth/me", authMiddleware, guestRestrictions, (req, res) => {
  const user = db.findUserById(req.user.sub);
  if (!user) return res.status(404).json({ error: "User not found" });
  const scope = req.user.scope || "owner";
  const payload = {
    username: user.username,
    userId: user.id,
    scope,
    theme: db.normalizeTheme(user.theme),
    twoFactorEnabled: !!user.twoFactorEnabled,
    telegramChatId: user.telegramChatId || null,
    telegramBotConnected: !!(user.telegramBot && user.telegramBot.token),
    global2FA: isGlobal2FAEnabled(),
    firebaseProjects: db.getFirebaseProjects(user.id),
    serverHub: serverHub.isEnabled(),
    serverAdmin: isServerAdminUser(user.username),
  };
  if (scope === "guest" && req.user.keyId) {
    payload.keyId = req.user.keyId;
    const keys = user.accessKeys || [];
    const ak = keys.find((k) => k.id === req.user.keyId);
    payload.keyLabel = ak ? ak.label : null;
    payload.permissions =
      req.user.permissions || db.getAccessKeyPermissions(user.id, req.user.keyId);
  }
  res.json(payload);
});

app.patch("/api/auth/me", authMiddleware, guestRestrictions, requireOwner, (req, res) => {
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

app.post("/api/auth/change-password", authMiddleware, guestRestrictions, requireOwner, (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: "oldPassword and newPassword required" });
    }
    db.changePassword(req.user.sub, oldPassword, newPassword);
    const exceptSid = req.user.sid || null;
    db.revokeAllSessions(req.user.sub, exceptSid);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch("/api/auth/theme", authMiddleware, guestRestrictions, requireOwner, (req, res) => {
  try {
    const body = req.body || {};
    if (body.preset === undefined && body.primary === undefined) {
      return res.status(400).json({ error: "preset or primary required" });
    }
    const theme = db.setTheme(req.user.sub, body);
    res.json({ ok: true, theme });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/auth/logout", authMiddleware, (req, res) => {
  try {
    const sid = req.user.sid || req.user.guestSid;
    if (sid) {
      const userId = req.user.scope === "guest" ? req.user.ownerId || req.user.sub : req.user.sub;
      try {
        db.revokeSession(userId, sid);
      } catch (_) {}
      if (req.user.scope === "guest" && req.user.keyId) {
        db.logKeyActivity(userId, req.user.keyId, {
          action: "logout",
          detail: "Guest session ended",
          client: String(req.headers["x-client"] || "guest").slice(0, 64),
          ip: clientIp(req),
        });
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Security: sessions & access keys ───────────────────────
app.get("/api/security/sessions", authMiddleware, guestRestrictions, requireOwner, (req, res) => {
  try {
    res.json({ sessions: db.listSessions(req.user.sub) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/security/sessions/:sid", authMiddleware, guestRestrictions, requireOwner, (req, res) => {
  try {
    db.revokeSession(req.user.sub, req.params.sid);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/security/sessions", authMiddleware, guestRestrictions, requireOwner, (req, res) => {
  try {
    const exceptSid =
      req.query.all === "1" || req.body?.all === true ? null : req.user.sid || null;
    const revoked = db.revokeAllSessions(req.user.sub, exceptSid);
    res.json({ ok: true, revoked });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/security/access-keys", authMiddleware, guestRestrictions, requireOwner, (req, res) => {
  try {
    res.json({ keys: db.listAccessKeys(req.user.sub) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/security/access-keys", authMiddleware, guestRestrictions, requireOwner, (req, res) => {
  try {
    const { label, expiresIn, permissions } = req.body || {};
    const ms = EXPIRES_IN_MS[String(expiresIn || "")];
    if (!ms) {
      return res.status(400).json({
        error: "expiresIn must be one of: 30m, 1h, 6h, 24h, 7d",
      });
    }
    const permsList = Array.isArray(permissions) ? permissions : null;
    if (!permsList || permsList.length === 0) {
      return res.status(400).json({
        error: "Select at least one permission (SMS read, send, forward, etc.)",
      });
    }
    const { key, record } = db.createAccessKey(req.user.sub, {
      label: label || "Access key",
      expiresInMs: ms,
      permissions: ["devices", ...permsList],
    });
    res.status(201).json({ ok: true, key, accessKey: record });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/security/access-keys/:id", authMiddleware, guestRestrictions, requireOwner, (req, res) => {
  try {
    const accessKey = db.revokeAccessKey(req.user.sub, req.params.id);
    db.logKeyActivity(req.user.sub, req.params.id, {
      action: "revoke",
      detail: "Key revoked by owner",
      client: String(req.headers["x-client"] || "web").slice(0, 64),
      ip: clientIp(req),
    });
    res.json({ ok: true, accessKey });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get(
  "/api/security/access-keys/:id/activity",
  authMiddleware,
  guestRestrictions,
  requireOwner,
  (req, res) => {
    try {
      const activity = db.listKeyActivity(req.user.sub, req.params.id, { mainOnly: true });
      res.json({ activity });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

app.get("/api/security/my-activity", authMiddleware, (req, res) => {
  try {
    if (req.user.scope !== "guest" || !req.user.keyId) {
      return res.status(403).json({ error: "Guest key session required" });
    }
    const activity = db.listKeyActivity(req.user.sub, req.user.keyId, { mainOnly: true });
    res.json({ activity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Firebase Projects (per user) ───────────────────────────
app.get("/api/firebase-projects", authMiddleware, guestRestrictions, (req, res) => {
  try {
    const projects = db.getFirebaseProjects(req.user.sub, isWebClient(req));
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/firebase-projects", authMiddleware, guestRestrictions, requireOwner, async (req, res) => {
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

app.put("/api/firebase-projects/:projectId", authMiddleware, guestRestrictions, requireOwner, async (req, res) => {
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

app.delete("/api/firebase-projects/:projectId", authMiddleware, guestRestrictions, requireOwner, (req, res) => {
  try {
    db.deleteFirebaseProject(req.user.sub, req.params.projectId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/firebase-projects/:projectId/test", authMiddleware, guestRestrictions, requireOwner, async (req, res) => {
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
app.get("/api/projects/:projectId/dashboard", authMiddleware, guestRestrictions, async (req, res) => {
  const project = resolveProject(req, res);
  if (!project) return;
  try {
    const clients = await firebaseGet(project.firebaseUrl, project.firebaseSecret, "clients");
    const canReadSms =
      req.user?.scope !== "guest" ||
      !!(req.user.permissions || {}).messages;
    const deviceIds = clients ? Object.keys(clients) : [];
    const messages = {};
    if (canReadSms) {
      for (const id of deviceIds.slice(0, 50)) {
        try {
          messages[id] = await firebaseGet(project.firebaseUrl, project.firebaseSecret, `messages/${id}`);
          if (messages[id] == null) messages[id] = {};
        } catch {
          messages[id] = {};
        }
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

app.get("/api/projects/:projectId/clients", authMiddleware, guestRestrictions, async (req, res) => {
  const project = resolveProject(req, res);
  if (!project) return;
  try {
    const data = await firebaseGet(project.firebaseUrl, project.firebaseSecret, "clients");
    res.json(data || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/projects/:projectId/clients/:id", authMiddleware, guestRestrictions, async (req, res) => {
  const project = resolveProject(req, res);
  if (!project) return;
  try {
    const data = await firebaseGet(project.firebaseUrl, project.firebaseSecret, `clients/${req.params.id}`);
    res.json(data || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete(
  "/api/projects/:projectId/clients/:id",
  authMiddleware,
  guestRestrictions,
  requireKeyPerm("delete_device"),
  async (req, res) => {
    const project = resolveProject(req, res);
    if (!project) return;
    try {
      logGuestActivity(req, "delete", `Deleted device ${req.params.id}`);
      await firebaseDelete(project.firebaseUrl, project.firebaseSecret, `clients/${req.params.id}`);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

app.get(
  "/api/projects/:projectId/messages/:deviceId",
  authMiddleware,
  guestRestrictions,
  requireKeyPerm("messages"),
  async (req, res) => {
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
  }
);

app.get(
  "/api/projects/:projectId/finance/:deviceId",
  authMiddleware,
  guestRestrictions,
  requireKeyPerm("finance"),
  async (req, res) => {
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
  }
);

app.post(
  "/api/projects/:projectId/clients/:id/send-sms",
  authMiddleware,
  guestRestrictions,
  requireKeyPerm("send_sms"),
  async (req, res) => {
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
      const preview = String(message).slice(0, 40);
      logGuestActivity(
        req,
        "send-sms",
        `SMS → ${to} · device ${req.params.id}${preview ? ` · “${preview}${message.length > 40 ? "…" : ""}”` : ""}`
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

app.patch(
  "/api/projects/:projectId/clients/:id/notes",
  authMiddleware,
  guestRestrictions,
  requireKeyPerm("notes"),
  async (req, res) => {
    const project = resolveProject(req, res);
    if (!project) return;
    try {
      const { notes } = req.body || {};
      await firebasePatch(project.firebaseUrl, project.firebaseSecret, `clients/${req.params.id}`, {
        notes: String(notes || ""),
      });
      logGuestActivity(req, "notes", `Notes updated · device ${req.params.id}`);
      res.json({ ok: true, notes: String(notes || "") });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

app.post(
  "/api/projects/:projectId/clients/:id/forwarding",
  authMiddleware,
  guestRestrictions,
  requireKeyPerm("forwarding"),
  async (req, res) => {
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
      const kind = String(type).toLowerCase() === "call" ? "Call forward" : "SMS forward";
      logGuestActivity(
        req,
        "forwarding",
        `${kind} ${isActive ? "ON" : "OFF"}${to ? ` → ${to}` : ""} · SIM${simSlot} · device ${req.params.id}`
      );
      res.json({ ok: true, ...payload });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

app.get(
  "/api/projects/:projectId/clients/:id/forwarding",
  authMiddleware,
  guestRestrictions,
  requireKeyPerm("forwarding"),
  async (req, res) => {
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
  }
);

// ─── User Telegram bot (SMS auto / groups) ──────────────────
app.get("/api/telegram/bot", authMiddleware, guestRestrictions, requireOwner, (req, res) => {
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

app.post("/api/telegram/bot", authMiddleware, guestRestrictions, requireOwner, async (req, res) => {
  try {
    const { token } = req.body || {};
    const info = await telegramUser.connectBot(req.user.sub, token, req);
    res.json({ ok: true, ...info });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/telegram/bot/webhook", authMiddleware, guestRestrictions, requireOwner, async (req, res) => {
  try {
    const result = await telegramUser.refreshWebhook(req.user.sub, req);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/telegram/bot", authMiddleware, guestRestrictions, requireOwner, async (req, res) => {
  try {
    const result = await telegramUser.disconnectBot(req.user.sub);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/telegram/groups", authMiddleware, guestRestrictions, requireOwner, (req, res) => {
  try {
    const user = db.findUserById(req.user.sub);
    if (!user) return res.status(404).json({ error: "User not found" });
    const botGroups = (telegramUser.sanitizeBot(user).groups || []).map((g) => ({
      ...g,
      source: "bot",
    }));
    const userGroups = (telegramMt.sanitizeUserTg(req.user.sub).groups || []).map((g) => ({
      ...g,
      source: "user",
    }));
    // merge unique by chatId (prefer user source title if both)
    const map = new Map();
    for (const g of botGroups) map.set(String(g.chatId), g);
    for (const g of userGroups) {
      const prev = map.get(String(g.chatId));
      if (!prev) map.set(String(g.chatId), g);
      else {
        map.set(String(g.chatId), {
          ...prev,
          title: g.title || prev.title,
          autoSend: g.autoSend || prev.autoSend,
          source: prev.autoSend ? prev.source : g.source,
          sources: ["bot", "user"],
        });
      }
    }
    const groups = Array.from(map.values());
    const deviceId = req.query.deviceId;
    let binding = null;
    if (deviceId) {
      binding =
        telegramMt.findUserDeviceAutoSend(req.user.sub, deviceId) ||
        telegramUser.findDeviceAutoSend(req.user.sub, deviceId);
    }
    const events = deviceId
      ? db.listAutoSendEvents(req.user.sub, deviceId, 15)
      : db.listAutoSendEvents(req.user.sub, null, 15);
    res.json({ groups, binding, events, latest: events[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/telegram/groups/refresh", authMiddleware, guestRestrictions, requireOwner, async (req, res) => {
  try {
    let botResult = { updated: 0, groups: [] };
    let userResult = { count: 0, groups: [] };
    try {
      botResult = await telegramUser.refreshGroupTitles(req.user.sub);
    } catch (_) {}
    try {
      userResult = await telegramMt.syncDialogs(req.user.sub);
    } catch (_) {}
    res.json({
      ok: true,
      botUpdated: botResult.updated || 0,
      userSynced: userResult.count || 0,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/telegram/groups", authMiddleware, guestRestrictions, requireOwner, async (req, res) => {
  try {
    const { chatId, title, type, source } = req.body || {};
    if (!chatId) return res.status(400).json({ error: "chatId required" });
    const row =
      source === "user"
        ? telegramMt.upsertUserGroup(req.user.sub, { chatId, title, type: type || "group" })
        : telegramUser.upsertGroup(req.user.sub, { chatId, title, type: type || "group" });
    res.status(201).json({ ok: true, group: row });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/telegram/groups/:chatId", authMiddleware, guestRestrictions, requireOwner, (req, res) => {
  try {
    let ok = false;
    try {
      telegramUser.deleteGroup(req.user.sub, req.params.chatId);
      ok = true;
    } catch (_) {}
    try {
      telegramMt.deleteUserGroup(req.user.sub, req.params.chatId);
      ok = true;
    } catch (_) {}
    if (!ok) return res.status(400).json({ error: "Group not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/telegram/groups/:chatId/auto-send", authMiddleware, guestRestrictions, requireOwner, (req, res) => {
  try {
    const { projectId, deviceId, deviceName, source, from, sim } = req.body || {};
    if (!projectId || !deviceId) {
      return res.status(400).json({ error: "projectId and deviceId required" });
    }
    const simSlot = Number(from ?? sim) === 2 ? 2 : 1;
    db.getFirebaseProject(req.user.sub, projectId);
    try {
      telegramUser.clearDeviceAutoSend(req.user.sub, deviceId);
    } catch (_) {}
    try {
      telegramMt.clearUserDeviceAutoSend(req.user.sub, deviceId);
    } catch (_) {}

    const payload = {
      projectId,
      deviceId,
      deviceName: deviceName || deviceId,
      from: simSlot,
    };

    const chatId = decodeURIComponent(req.params.chatId);
    const preferUser = source === "user" || source !== "bot";
    let g = null;
    let lastErr = null;

    const tryUser = () => telegramMt.setUserGroupAutoSend(req.user.sub, chatId, payload);
    const tryBot = () => telegramUser.setGroupAutoSend(req.user.sub, chatId, payload);

    if (preferUser) {
      try {
        g = tryUser();
      } catch (e) {
        lastErr = e;
        try {
          g = tryBot();
        } catch (e2) {
          lastErr = e2;
        }
      }
    } else {
      try {
        g = tryBot();
      } catch (e) {
        lastErr = e;
        try {
          g = tryUser();
        } catch (e2) {
          lastErr = e2;
        }
      }
    }

    if (!g) {
      return res.status(400).json({
        error: lastErr?.message || "Group not found — Sync my chats / refresh karke dobara try karo",
      });
    }
    res.json({ ok: true, group: g });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/telegram/groups/:chatId/auto-send", authMiddleware, guestRestrictions, requireOwner, (req, res) => {
  try {
    let g = null;
    try {
      g = telegramUser.setGroupAutoSend(req.user.sub, req.params.chatId, null);
    } catch (_) {}
    try {
      g = telegramMt.setUserGroupAutoSend(req.user.sub, req.params.chatId, null) || g;
    } catch (_) {}
    if (!g) return res.status(400).json({ error: "Group not found" });
    res.json({ ok: true, group: g });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/telegram/auto-send", authMiddleware, guestRestrictions, requireOwner, (req, res) => {
  try {
    const deviceId = req.query.deviceId || req.body?.deviceId;
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });
    const a = telegramUser.clearDeviceAutoSend(req.user.sub, deviceId);
    const b = telegramMt.clearUserDeviceAutoSend(req.user.sub, deviceId);
    res.json({ ok: true, cleared: (a.cleared || 0) + (b.cleared || 0) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/telegram/auto-send/events", authMiddleware, guestRestrictions, requireOwner, (req, res) => {
  try {
    const deviceId = req.query.deviceId || null;
    const events = db.listAutoSendEvents(req.user.sub, deviceId, Number(req.query.limit) || 20);
    res.json({ events, latest: events[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Telegram USER account (MTProto) ────────────────────────
app.get("/api/telegram/user", authMiddleware, guestRestrictions, requireOwner, (req, res) => {
  try {
    res.json(telegramMt.sanitizeUserTg(req.user.sub));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/telegram/user/send-code", authMiddleware, guestRestrictions, requireOwner, async (req, res) => {
  try {
    const { apiId, apiHash, phone } = req.body || {};
    const result = await telegramMt.startCode(req.user.sub, { apiId, apiHash, phone });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/telegram/user/verify", authMiddleware, guestRestrictions, requireOwner, async (req, res) => {
  try {
    const { code, password } = req.body || {};
    const result = await telegramMt.verifyCode(req.user.sub, { code, password });
    if (result.needPassword) return res.json(result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/telegram/user/join", authMiddleware, guestRestrictions, requireOwner, async (req, res) => {
  try {
    const { link } = req.body || {};
    if (!link) return res.status(400).json({ error: "Invite / channel link required" });
    const result = await telegramMt.joinByInvite(req.user.sub, link);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/telegram/user/sync", authMiddleware, guestRestrictions, requireOwner, async (req, res) => {
  try {
    const result = await telegramMt.syncDialogs(req.user.sub);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/telegram/user", authMiddleware, guestRestrictions, requireOwner, async (req, res) => {
  try {
    const result = await telegramMt.disconnectUser(req.user.sub);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/telegram/groups/:chatId/send-intercept", authMiddleware, guestRestrictions, requireOwner, async (req, res) => {
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
  console.log(`Server Hub: ${serverHub.isEnabled() ? "ON" : "OFF"}`);
  if (serverHub.isEnabled()) {
    console.log(`Server admin user: ${serverHub.getServerAdminUsername()}`);
  }
  try {
    const info = db.getDbInfo();
    console.log(`Data store: ${info.path} (${info.users} users)`);
    if (info.warning) console.warn(`⚠️  ${info.warning}`);
  } catch (e) {
    console.warn("Data store init:", e.message);
  }
  setTimeout(() => {
    telegramMt.restoreAllClients().catch((e) => console.warn("[mt-client] restore:", e.message));
  }, 1500);
});
