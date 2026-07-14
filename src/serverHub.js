const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

function isEnabled() {
  return process.env.SERVER_HUB_ENABLED === "true";
}

function getServerAdminUsername() {
  return (process.env.SERVER_ADMIN_USERNAME || "admin").trim().toLowerCase();
}

function isServerAdmin(username) {
  if (!isEnabled()) return false;
  return String(username || "").trim().toLowerCase() === getServerAdminUsername();
}

function resolveAppsPath() {
  if (process.env.APPS_CONFIG_PATH) return path.resolve(process.env.APPS_CONFIG_PATH);
  if (process.env.DATA_PATH) {
    return path.join(path.dirname(path.resolve(process.env.DATA_PATH)), "apps.json");
  }
  if (fs.existsSync("/var/darkpanel/data")) {
    return "/var/darkpanel/data/apps.json";
  }
  return path.join(__dirname, "..", "data", "apps.json");
}

const APPS_PATH = resolveAppsPath();

function ensureAppsConfig() {
  const dir = path.dirname(APPS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(APPS_PATH)) {
    const defaultApp = {
      id: "darkpanel",
      name: "Dark Panel",
      repo: "https://github.com/omjishingh/darkpanel.git",
      branch: "main",
      path: process.env.SERVER_HUB_DEFAULT_PATH || "/var/darkpanel",
      pm2Name: "darkpanel",
      startScript: "src/index.js",
      type: "node",
      webhookSecret: crypto.randomBytes(18).toString("hex"),
      createdAt: new Date().toISOString(),
    };
    writeApps({ apps: [defaultApp], deployLogs: [] });
  }
}

function readApps() {
  ensureAppsConfig();
  return JSON.parse(fs.readFileSync(APPS_PATH, "utf8"));
}

function writeApps(data) {
  const dir = path.dirname(APPS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = APPS_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, APPS_PATH);
}

function sanitizeAppId(id) {
  return String(id || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

function findApp(appId) {
  const data = readApps();
  const app = (data.apps || []).find((a) => a.id === appId);
  if (!app) throw new Error("App not found");
  return { data, app };
}

function getPublicBaseUrl() {
  return (
    process.env.PUBLIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    `http://localhost:${process.env.PORT || 3000}`
  ).replace(/\/$/, "");
}

function webhookUrl(app) {
  return `${getPublicBaseUrl()}/api/deploy/webhook/${app.id}?secret=${app.webhookSecret}`;
}

async function runCmd(cmd, args, cwd, timeoutMs = 120000) {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return { stdout: stdout || "", stderr: stderr || "" };
}

async function pm2List() {
  try {
    const { stdout } = await runCmd("pm2", ["jlist"], process.cwd(), 15000);
    const list = JSON.parse(stdout || "[]");
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return { error: e.message || "PM2 not available" };
  }
}

function matchPm2Process(list, app) {
  if (!Array.isArray(list)) return null;
  return list.find((p) => {
    const name = p?.name || p?.pm2_env?.name;
    return name === app.pm2Name;
  });
}

async function getAppsStatus() {
  const data = readApps();
  const pm2 = await pm2List();
  const pm2Error = pm2.error || null;
  const processes = Array.isArray(pm2) ? pm2 : [];

  const apps = (data.apps || []).map((app) => {
    const proc = matchPm2Process(processes, app);
    const status = proc?.pm2_env?.status || "not_found";
    return {
      ...app,
      webhookSecret: undefined,
      status,
      memory: proc?.monit?.memory || 0,
      cpu: proc?.monit?.cpu || 0,
      uptime: proc?.pm2_env?.pm_uptime || null,
      restarts: proc?.pm2_env?.restart_time || 0,
      webhookUrl: webhookUrl(app),
    };
  });

  return {
    enabled: isEnabled(),
    serverAdmin: getServerAdminUsername(),
    appsPath: APPS_PATH,
    pm2Error,
    apps,
    deployLogs: (data.deployLogs || []).slice(0, 50),
  };
}

function addDeployLog(entry) {
  const data = readApps();
  data.deployLogs = data.deployLogs || [];
  data.deployLogs.unshift({
    id: `dep_${Date.now()}`,
    at: new Date().toISOString(),
    ...entry,
  });
  data.deployLogs = data.deployLogs.slice(0, 100);
  writeApps(data);
}

async function deployApp(appId, meta = {}) {
  const { app } = findApp(appId);
  const appPath = path.resolve(app.path);

  if (!fs.existsSync(appPath)) {
    throw new Error(`App path not found: ${appPath}`);
  }

  const steps = [];
  const log = { appId, appName: app.name, trigger: meta.trigger || "manual", ok: false, steps: [] };

  try {
    let out;

    if (app.repo) {
      out = await runCmd("git", ["fetch", "origin", app.branch || "main"], appPath, 90000);
      steps.push({ cmd: "git fetch", out: out.stdout.slice(-2000), err: out.stderr.slice(-500) });

      out = await runCmd("git", ["reset", "--hard", `origin/${app.branch || "main"}`], appPath, 30000);
      steps.push({ cmd: "git reset", out: out.stdout.slice(-500), err: out.stderr.slice(-500) });
    }

    if (app.type !== "python" && fs.existsSync(path.join(appPath, "package.json"))) {
      out = await runCmd("npm", ["install", "--production=false"], appPath, 180000);
      steps.push({ cmd: "npm install", out: out.stdout.slice(-2000), err: out.stderr.slice(-500) });
    }

    if (app.type === "python" && fs.existsSync(path.join(appPath, "requirements.txt"))) {
      out = await runCmd("pip3", ["install", "-r", "requirements.txt"], appPath, 180000);
      steps.push({ cmd: "pip install", out: out.stdout.slice(-2000), err: out.stderr.slice(-500) });
    }

    const pm2 = await pm2List();
    const proc = Array.isArray(pm2) ? matchPm2Process(pm2, app) : null;

    if (proc) {
      out = await runCmd("pm2", ["restart", app.pm2Name], appPath, 30000);
      steps.push({ cmd: "pm2 restart", out: out.stdout.slice(-1000), err: out.stderr.slice(-500) });
    } else if (app.startScript) {
      const scriptPath = path.join(appPath, app.startScript);
      if (!fs.existsSync(scriptPath)) {
        throw new Error(`Start script not found: ${scriptPath}`);
      }
      const pm2Args =
        app.type === "python"
          ? ["start", app.startScript, "--name", app.pm2Name, "--cwd", appPath, "--interpreter", "python3"]
          : ["start", app.startScript, "--name", app.pm2Name, "--cwd", appPath];
      out = await runCmd("pm2", pm2Args, appPath, 30000);
      steps.push({ cmd: "pm2 start", out: out.stdout.slice(-1000), err: out.stderr.slice(-500) });
    } else {
      throw new Error("PM2 process not found and no startScript configured");
    }

    log.ok = true;
    log.steps = steps;
    addDeployLog({ ...log, branch: app.branch, commit: meta.commit || null });
    return log;
  } catch (e) {
    log.ok = false;
    log.error = e.message;
    log.steps = steps;
    addDeployLog(log);
    throw e;
  }
}

async function pm2Action(appId, action) {
  const { app } = findApp(appId);
  const allowed = { restart: ["restart"], stop: ["stop"], start: ["start"] };
  if (!allowed[action]) throw new Error("Invalid action");

  const out = await runCmd("pm2", [...allowed[action], app.pm2Name], app.path, 30000);
  return { ok: true, action, output: (out.stdout || "") + (out.stderr || "") };
}

async function getAppLogs(appId, lines = 80) {
  const { app } = findApp(appId);
  const n = Math.min(Math.max(parseInt(lines, 10) || 80, 10), 300);
  try {
    const out = await runCmd("pm2", ["logs", app.pm2Name, "--lines", String(n), "--nostream"], app.path, 20000);
    return { appId, lines: n, text: (out.stdout || "") + (out.stderr || "") };
  } catch (e) {
    return { appId, lines: n, text: `No logs: ${e.message}` };
  }
}

function addApp(payload) {
  const data = readApps();
  const id = sanitizeAppId(payload.id || payload.name);
  if (!id) throw new Error("Valid app id required");
  if ((data.apps || []).some((a) => a.id === id)) throw new Error("App id already exists");

  const app = {
    id,
    name: String(payload.name || id).slice(0, 64),
    repo: payload.repo ? String(payload.repo).trim() : "",
    branch: String(payload.branch || "main").slice(0, 64),
    path: path.resolve(String(payload.path || "").trim()),
    pm2Name: sanitizeAppId(payload.pm2Name || id) || id,
    startScript: String(payload.startScript || "").trim(),
    type: payload.type === "python" ? "python" : "node",
    webhookSecret: crypto.randomBytes(18).toString("hex"),
    createdAt: new Date().toISOString(),
  };

  if (!app.path) throw new Error("path required");
  data.apps = data.apps || [];
  data.apps.push(app);
  writeApps(data);
  return { ...app, webhookUrl: webhookUrl(app) };
}

function deleteApp(appId) {
  const data = readApps();
  const before = (data.apps || []).length;
  data.apps = (data.apps || []).filter((a) => a.id !== appId);
  if (data.apps.length === before) throw new Error("App not found");
  writeApps(data);
  return { ok: true };
}

function verifyWebhook(appId, secret) {
  const { app } = findApp(appId);
  if (!secret || secret !== app.webhookSecret) {
    throw new Error("Invalid webhook secret");
  }
  return app;
}

function handleGithubPush(payload, app) {
  const ref = payload?.ref || "";
  const branch = app.branch || "main";
  const expectedRef = `refs/heads/${branch}`;
  if (ref && ref !== expectedRef) {
    return { skipped: true, reason: `Push was to ${ref}, watching ${expectedRef}` };
  }
  const commit = payload?.after || payload?.head_commit?.id || null;
  return { skipped: false, commit };
}

module.exports = {
  isEnabled,
  isServerAdmin,
  getServerAdminUsername,
  getAppsStatus,
  deployApp,
  pm2Action,
  getAppLogs,
  addApp,
  deleteApp,
  verifyWebhook,
  handleGithubPush,
  webhookUrl,
  getPublicBaseUrl,
};
