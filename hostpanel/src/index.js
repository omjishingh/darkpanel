require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { createToken, authMiddleware } = require("./auth");
const store = require("./store");
const manager = require("./manager");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

store.ensureDefaultAdmin();

const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const maxMb = parseInt(process.env.MAX_UPLOAD_MB || "50", 10);
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: maxMb * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ok = /\.zip$/i.test(file.originalname);
    cb(ok ? null : new Error("Only .zip files allowed"), ok);
  },
});

app.get("/api/health", (_, res) => {
  res.json({ ok: true, name: "HOST PANEL", version: "1.0.0" });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  const user = store.verifyPassword(username, password);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  res.json({
    token: createToken(user),
    username: user.username,
  });
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  res.json({ username: req.user.username });
});

app.get("/api/apps", authMiddleware, async (_, res) => {
  try {
    res.json(await manager.getStatus());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/apps", authMiddleware, (req, res) => {
  try {
    const appRec = manager.registerApp(req.body || {});
    res.status(201).json({ ok: true, app: appRec });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/apps/upload", authMiddleware, (req, res) => {
  upload.single("zip")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "ZIP file required" });

    try {
      const meta = {
        id: req.body.id,
        name: req.body.name,
        type: req.body.type,
        startScript: req.body.startScript,
        pm2Name: req.body.pm2Name,
      };
      const result = await manager.uploadZipApp({ zipPath: req.file.path, meta });
      res.status(201).json({ ok: true, ...result });
    } catch (e) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {}
      res.status(500).json({ error: e.message });
    }
  });
});

app.post("/api/apps/:id/deploy", authMiddleware, async (req, res) => {
  try {
    const log = await manager.deployApp(req.params.id, { trigger: "manual" });
    res.json({ ok: true, log });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/apps/:id/:action", authMiddleware, async (req, res) => {
  const { id, action } = req.params;
  if (!["restart", "stop", "start"].includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }
  try {
    res.json(await manager.pm2Action(id, action));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/apps/:id/logs", authMiddleware, async (req, res) => {
  try {
    res.json(await manager.getLogs(req.params.id, req.query.lines));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/apps/:id", authMiddleware, (req, res) => {
  try {
    const delFiles = req.query.files === "1";
    res.json(manager.removeApp(req.params.id, delFiles));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/apps/:id/env", authMiddleware, (req, res) => {
  try {
    const appRec = store.findApp(req.params.id);
    appRec.env = req.body?.env && typeof req.body.env === "object" ? req.body.env : {};
    store.saveApp(appRec);
    res.json({ ok: true, env: appRec.env });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/webhook/:id", async (req, res) => {
  try {
    const appRec = manager.verifyWebhook(req.params.id, req.query.secret);
    const check = manager.handleGithubPush(req.body || {}, appRec);
    if (check.skipped) return res.json({ ok: true, skipped: true, reason: check.reason });
    const log = await manager.deployApp(appRec.id, { trigger: "github", commit: check.commit });
    res.json({ ok: true, log });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/", (_, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.use(express.static(path.join(__dirname, "..", "public")));

const port = process.env.PORT || 3100;
app.listen(port, () => {
  console.log(`HOST PANEL running on http://localhost:${port}`);
  console.log(`Apps root: ${store.getAppsRoot()}`);
  console.log(`Public URL: ${manager.publicUrl()}`);
});
