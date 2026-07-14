const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const AdmZip = require("adm-zip");
const store = require("./store");

const execFileAsync = promisify(execFile);

function publicUrl() {
  return (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3100}`).replace(/\/$/, "");
}

function webhookUrl(app) {
  return `${publicUrl()}/api/webhook/${app.id}?secret=${app.webhookSecret}`;
}

async function run(cmd, args, cwd, timeout = 120000) {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    cwd,
    timeout,
    maxBuffer: 5 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return { stdout: stdout || "", stderr: stderr || "" };
}

async function pm2List() {
  try {
    const { stdout } = await run("pm2", ["jlist"], process.cwd(), 15000);
    const list = JSON.parse(stdout || "[]");
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return { error: e.message };
  }
}

function procName(proc) {
  return proc?.name || proc?.pm2_env?.name || null;
}

function matchProc(list, app) {
  if (!Array.isArray(list)) return null;
  const appPath = path.resolve(app.path);
  return list.find((p) => {
    const name = procName(p);
    if (name === app.pm2Name || name === app.id) return true;
    const cwd = p?.pm2_env?.pm_cwd;
    return cwd && path.resolve(cwd) === appPath;
  });
}

async function getPm2NameForApp(app) {
  const pm2 = await pm2List();
  if (!Array.isArray(pm2)) return app.pm2Name || app.id;
  const proc = matchProc(pm2, app);
  if (!proc) return app.pm2Name || app.id;
  const actual = procName(proc);
  if (actual && actual !== app.pm2Name) {
    app.pm2Name = actual;
    store.saveApp(app);
  }
  return actual || app.pm2Name || app.id;
}

async function pm2DeleteQuiet(name) {
  if (!name) return;
  try {
    await run("pm2", ["delete", name], process.cwd(), 15000);
  } catch (_) {}
}

async function getStatus() {
  const pm2 = await pm2List();
  const pm2Error = pm2.error || null;
  const processes = Array.isArray(pm2) ? pm2 : [];

  const apps = store.listApps().map((app) => {
    const proc = matchProc(processes, app);
    return {
      ...app,
      webhookSecret: undefined,
      env: app.env || {},
      status: proc?.pm2_env?.status || "not_found",
      memory: proc?.monit?.memory || 0,
      cpu: proc?.monit?.cpu || 0,
      restarts: proc?.pm2_env?.restart_time || 0,
      uptime: proc?.pm2_env?.pm_uptime || null,
      webhookUrl: webhookUrl(app),
      pathExists: fs.existsSync(app.path),
    };
  });

  return {
    appsRoot: store.getAppsRoot(),
    pm2Error,
    apps,
    deployLogs: store.getDeployLogs(40),
    publicUrl: publicUrl(),
  };
}

function createAppRecord(payload) {
  const id = store.sanitizeId(payload.id || payload.name);
  if (!id) throw new Error("Valid app id required");
  if (store.listApps().some((a) => a.id === id)) throw new Error("App id already exists");

  const appPath = path.join(store.getAppsRoot(), id);
  const app = {
    id,
    name: String(payload.name || id).slice(0, 80),
    type: payload.type === "python" ? "python" : "node",
    source: payload.source || "git",
    repo: String(payload.repo || "").trim(),
    branch: String(payload.branch || "main").trim(),
    path: appPath,
    pm2Name: store.sanitizeId(payload.pm2Name || id) || id,
    startScript: String(payload.startScript || "").trim(),
    env: payload.env && typeof payload.env === "object" ? payload.env : {},
    webhookSecret: crypto.randomBytes(18).toString("hex"),
    createdAt: new Date().toISOString(),
  };
  if (!app.startScript) {
    app.startScript = app.type === "python" ? "main.py" : "index.js";
  }
  return app;
}

function registerApp(payload) {
  const app = createAppRecord(payload);
  if (!fs.existsSync(app.path)) fs.mkdirSync(app.path, { recursive: true });
  store.saveApp(app);
  return { ...app, webhookUrl: webhookUrl(app) };
}

function extractZip(zipPath, destDir) {
  if (!fs.existsSync(zipPath)) throw new Error("ZIP file missing");
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
  fs.mkdirSync(destDir, { recursive: true });
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(destDir, true);

  // If zip has single top-level folder, flatten it
  const entries = fs.readdirSync(destDir, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) {
    const inner = path.join(destDir, entries[0].name);
    const innerFiles = fs.readdirSync(inner);
    for (const f of innerFiles) {
      fs.renameSync(path.join(inner, f), path.join(destDir, f));
    }
    fs.rmdirSync(inner);
  }
}

async function installDeps(app) {
  const steps = [];
  if (app.type === "python" && fs.existsSync(path.join(app.path, "requirements.txt"))) {
    const out = await run("pip3", ["install", "-r", "requirements.txt"], app.path, 180000);
    steps.push({ cmd: "pip3 install -r requirements.txt", out: out.stdout.slice(-2500) });
  }
  if (app.type === "node" && fs.existsSync(path.join(app.path, "package.json"))) {
    const out = await run("npm", ["install"], app.path, 180000);
    steps.push({ cmd: "npm install", out: out.stdout.slice(-2500) });
  }
  return steps;
}

async function pm2StartOrRestart(app) {
  const pm2Name = store.sanitizeId(app.pm2Name || app.id) || app.id;
  app.pm2Name = pm2Name;

  const ecoPath = path.join(app.path, "ecosystem.hostpanel.cjs");
  const ecoApp = {
    name: pm2Name,
    script: app.startScript,
    cwd: app.path,
    env: app.env || {},
    max_restarts: 15,
  };
  if (app.type === "python") ecoApp.interpreter = "python3";
  fs.writeFileSync(ecoPath, "module.exports = " + JSON.stringify({ apps: [ecoApp] }, null, 2) + ";\n");

  const pm2 = await pm2List();
  const proc = Array.isArray(pm2) ? matchProc(pm2, app) : null;

  if (proc) {
    const actualName = procName(proc);
    try {
      const out = await run("pm2", ["restart", actualName, "--update-env"], app.path, 30000);
      if (actualName !== app.pm2Name) {
        app.pm2Name = actualName;
        store.saveApp(app);
      }
      return { cmd: "pm2 restart " + actualName, out: out.stdout + out.stderr };
    } catch (_) {
      await pm2DeleteQuiet(actualName);
    }
  }

  await pm2DeleteQuiet(app.pm2Name);
  await pm2DeleteQuiet(app.id);

  try {
    const out = await run("pm2", ["start", ecoPath, "--update-env"], app.path, 30000);
    store.saveApp(app);
    return { cmd: "pm2 start", out: out.stdout + out.stderr };
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.includes("already launched") || msg.includes("Already exists")) {
      await pm2DeleteQuiet(pm2Name);
      const out = await run("pm2", ["start", ecoPath, "-f", "--update-env"], app.path, 30000);
      store.saveApp(app);
      return { cmd: "pm2 start -f", out: out.stdout + out.stderr };
    }
    throw e;
  }
}

async function deployApp(appId, meta = {}) {
  const app = store.findApp(appId);
  const log = { appId, appName: app.name, trigger: meta.trigger || "manual", ok: false, steps: [] };

  try {
    if (!fs.existsSync(app.path)) fs.mkdirSync(app.path, { recursive: true });

    if (app.source === "git" && app.repo) {
      if (!fs.existsSync(path.join(app.path, ".git"))) {
        const out = await run("git", ["clone", app.repo, app.path], store.getAppsRoot(), 120000);
        log.steps.push({ cmd: "git clone", out: out.stdout.slice(-1500) });
      } else {
        let out = await run("git", ["fetch", "origin", app.branch], app.path, 90000);
        log.steps.push({ cmd: "git fetch", out: out.stdout.slice(-800) });
        out = await run("git", ["reset", "--hard", `origin/${app.branch}`], app.path, 30000);
        log.steps.push({ cmd: "git reset", out: out.stdout.slice(-500) });
      }
    }

    const depSteps = await installDeps(app);
    log.steps.push(...depSteps);

    const pm2Step = await pm2StartOrRestart(app);
    log.steps.push(pm2Step);

    log.ok = true;
    store.addDeployLog({ ...log, commit: meta.commit || null });
    return log;
  } catch (e) {
    log.ok = false;
    log.error = e.message;
    store.addDeployLog(log);
    throw e;
  }
}

async function uploadZipApp({ zipPath, meta }) {
  const app = createAppRecord({ ...meta, source: "zip", repo: "" });
  extractZip(zipPath, app.path);
  store.saveApp(app);

  try {
    fs.unlinkSync(zipPath);
  } catch (_) {}

  const log = await deployApp(app.id, { trigger: "zip-upload" });
  return { app: { ...app, webhookUrl: webhookUrl(app) }, log };
}

async function pm2Action(appId, action) {
  const app = store.findApp(appId);
  const map = { restart: "restart", stop: "stop", start: "start", delete: "delete" };
  if (!map[action]) throw new Error("Invalid action");
  const name = await getPm2NameForApp(app);
  const out = await run("pm2", [map[action], name], app.path, 30000);
  return { ok: true, output: out.stdout + out.stderr };
}

async function getLogs(appId, lines = 100) {
  const app = store.findApp(appId);
  const name = await getPm2NameForApp(app);
  const n = Math.min(Math.max(parseInt(lines, 10) || 100, 10), 400);
  try {
    const out = await run("pm2", ["logs", name, "--lines", String(n), "--nostream"], app.path, 20000);
    return { text: out.stdout + out.stderr };
  } catch (e) {
    return { text: "No logs: " + e.message };
  }
}

function removeApp(appId, deleteFiles = false) {
  const app = store.findApp(appId);
  store.deleteApp(appId);
  if (deleteFiles && fs.existsSync(app.path)) {
    fs.rmSync(app.path, { recursive: true, force: true });
  }
  return { ok: true };
}

function verifyWebhook(appId, secret) {
  const app = store.findApp(appId);
  if (!secret || secret !== app.webhookSecret) throw new Error("Invalid webhook secret");
  return app;
}

function handleGithubPush(body, app) {
  const ref = body?.ref || "";
  const expected = `refs/heads/${app.branch || "main"}`;
  if (ref && ref !== expected) {
    return { skipped: true, reason: `Ignored push to ${ref}` };
  }
  return { skipped: false, commit: body?.after || body?.head_commit?.id || null };
}

module.exports = {
  getStatus,
  registerApp,
  deployApp,
  uploadZipApp,
  pm2Action,
  getLogs,
  removeApp,
  verifyWebhook,
  handleGithubPush,
  publicUrl,
};
