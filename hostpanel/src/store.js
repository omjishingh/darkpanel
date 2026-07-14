const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

function resolveDataPath() {
  if (process.env.DATA_PATH) return path.resolve(process.env.DATA_PATH);
  return path.join(__dirname, "..", "data", "store.json");
}

const DATA_PATH = resolveDataPath();

function ensureStore() {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_PATH)) {
    writeStore({ users: {}, apps: [], deployLogs: [] });
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
}

function writeStore(data) {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = DATA_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_PATH);
}

function ensureDefaultAdmin() {
  const store = readStore();
  if (Object.keys(store.users || {}).length > 0) return;

  const username = (process.env.ADMIN_USERNAME || "admin").trim();
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const id = "usr_" + crypto.randomBytes(6).toString("hex");
  store.users[id] = {
    id,
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: new Date().toISOString(),
  };
  writeStore(store);
  console.log(`[hostpanel] Default admin created: ${username}`);
}

function findUserByUsername(username) {
  const store = readStore();
  const un = String(username || "").trim().toLowerCase();
  return Object.values(store.users || {}).find((u) => u.username.toLowerCase() === un) || null;
}

function verifyPassword(username, password) {
  const user = findUserByUsername(username);
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.passwordHash)) return null;
  return user;
}

function sanitizeId(id) {
  return String(id || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

function listApps() {
  return readStore().apps || [];
}

function findApp(appId) {
  const app = listApps().find((a) => a.id === appId);
  if (!app) throw new Error("App not found");
  return app;
}

function saveApp(app) {
  const store = readStore();
  const idx = (store.apps || []).findIndex((a) => a.id === app.id);
  if (idx >= 0) store.apps[idx] = app;
  else store.apps.push(app);
  writeStore(store);
  return app;
}

function deleteApp(appId) {
  const store = readStore();
  const before = (store.apps || []).length;
  store.apps = (store.apps || []).filter((a) => a.id !== appId);
  if (store.apps.length === before) throw new Error("App not found");
  writeStore(store);
}

function addDeployLog(entry) {
  const store = readStore();
  store.deployLogs = store.deployLogs || [];
  store.deployLogs.unshift({
    id: "log_" + Date.now(),
    at: new Date().toISOString(),
    ...entry,
  });
  store.deployLogs = store.deployLogs.slice(0, 150);
  writeStore(store);
}

function getDeployLogs(limit = 50) {
  return (readStore().deployLogs || []).slice(0, limit);
}

function getAppsRoot() {
  const root = process.env.APPS_ROOT || path.join(__dirname, "..", "apps");
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return path.resolve(root);
}

module.exports = {
  ensureDefaultAdmin,
  findUserByUsername,
  verifyPassword,
  sanitizeId,
  listApps,
  findApp,
  saveApp,
  deleteApp,
  addDeployLog,
  getDeployLogs,
  getAppsRoot,
  readStore,
};
