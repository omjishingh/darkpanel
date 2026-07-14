const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

function resolveDbPath() {
  if (process.env.DATA_PATH) return path.resolve(process.env.DATA_PATH);
  // Prefer Render persistent disk mount if present
  if (fs.existsSync("/var/data")) {
    return path.join("/var/data", "accounts.json");
  }
  return path.join(__dirname, "..", "data", "accounts.json");
}

const DB_PATH = resolveDbPath();

function ensureDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: {} }, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDb(data) {
  ensureDb();
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_PATH);
  // Optional second copy (local download / secondary mount)
  if (process.env.DATA_BACKUP_PATH) {
    try {
      const bp = path.resolve(process.env.DATA_BACKUP_PATH);
      fs.mkdirSync(path.dirname(bp), { recursive: true });
      fs.writeFileSync(bp, JSON.stringify(data, null, 2));
    } catch (e) {
      console.warn("[db] backup write failed:", e.message);
    }
  }
}

function getDbInfo() {
  ensureDb();
  const data = readDb();
  const users = Object.keys(data.users || {}).length;
  const onEphemeral =
    DB_PATH.includes("/opt/render/project") || DB_PATH.includes(`${path.sep}src${path.sep}data`);
  return {
    path: DB_PATH,
    users,
    onEphemeral,
    warning: onEphemeral
      ? "DATA_PATH project folder me hai — Render deploy pe wipe ho sakta hai. /var/data + Disk use karo."
      : null,
  };
}

function exportDb() {
  ensureDb();
  return readDb();
}

function importDb(payload) {
  if (!payload || typeof payload !== "object" || !payload.users) {
    throw new Error("Invalid backup — users object required");
  }
  writeDb({ users: payload.users });
  return getDbInfo();
}

function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function findUserByUsername(username) {
  const db = readDb();
  const key = username.toLowerCase();
  for (const [id, user] of Object.entries(db.users)) {
    if (user.username.toLowerCase() === key) return { id, ...user };
  }
  return null;
}

function findUserById(userId) {
  const db = readDb();
  const user = db.users[userId];
  return user ? { id: userId, ...user } : null;
}

function createUser({ username, password, twoFactorEnabled = false, telegramChatId = null }) {
  const db = readDb();
  if (findUserByUsername(username)) {
    throw new Error("Username already exists");
  }
  const id = generateId("user");
  const user = {
    id,
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    twoFactorEnabled: !!twoFactorEnabled,
    telegramChatId: telegramChatId || null,
    createdAt: new Date().toISOString(),
    firebaseProjects: [],
    sessions: [],
    accessKeys: [],
    keyActivity: [],
    theme: { preset: "creative" },
  };
  db.users[id] = user;
  writeDb(db);
  return sanitizeUser(user);
}

function updateUser(userId, updates) {
  const db = readDb();
  const user = db.users[userId];
  if (!user) throw new Error("User not found");
  if (updates.password) {
    user.passwordHash = bcrypt.hashSync(updates.password, 10);
  }
  if (updates.twoFactorEnabled !== undefined) {
    user.twoFactorEnabled = !!updates.twoFactorEnabled;
  }
  if (updates.telegramChatId !== undefined) {
    user.telegramChatId = updates.telegramChatId;
  }
  if (updates.telegramBot !== undefined) {
    user.telegramBot = updates.telegramBot;
  }
  writeDb(db);
  return sanitizeUser(user);
}

function getTelegramBot(userId) {
  const user = findUserById(userId);
  if (!user) throw new Error("User not found");
  return user.telegramBot || null;
}

function setTelegramBot(userId, bot) {
  const db = readDb();
  const user = db.users[userId];
  if (!user) throw new Error("User not found");
  user.telegramBot = bot;
  writeDb(db);
  return user.telegramBot;
}

function clearTelegramBot(userId) {
  const db = readDb();
  const user = db.users[userId];
  if (!user) throw new Error("User not found");
  delete user.telegramBot;
  writeDb(db);
}

function getTelegramUserClient(userId) {
  const user = findUserById(userId);
  if (!user) throw new Error("User not found");
  return user.telegramUserClient || null;
}

function setTelegramUserClient(userId, data) {
  const db = readDb();
  const user = db.users[userId];
  if (!user) throw new Error("User not found");
  user.telegramUserClient = data;
  writeDb(db);
  return user.telegramUserClient;
}

function clearTelegramUserClient(userId) {
  const db = readDb();
  const user = db.users[userId];
  if (!user) throw new Error("User not found");
  delete user.telegramUserClient;
  writeDb(db);
}

function pushAutoSendEvent(userId, event) {
  const db = readDb();
  const user = db.users[userId];
  if (!user) return null;
  const row = {
    id: generateId("ase"),
    at: new Date().toISOString(),
    ms: Number(event.ms) || 0,
    deviceId: String(event.deviceId || ""),
    deviceName: String(event.deviceName || event.deviceId || ""),
    groupTitle: String(event.groupTitle || event.chatId || ""),
    chatId: String(event.chatId || ""),
    to: String(event.to || ""),
    preview: String(event.preview || "").slice(0, 80),
    source: String(event.source || "bot"),
  };
  user.autoSendEvents = [row, ...(user.autoSendEvents || [])].slice(0, 40);
  writeDb(db);
  return row;
}

function listAutoSendEvents(userId, deviceId = null, limit = 20) {
  const user = findUserById(userId);
  if (!user) return [];
  let list = user.autoSendEvents || [];
  if (deviceId) list = list.filter((e) => String(e.deviceId) === String(deviceId));
  return list.slice(0, limit);
}

function deleteUser(userId) {
  const db = readDb();
  if (!db.users[userId]) throw new Error("User not found");
  delete db.users[userId];
  writeDb(db);
}

function listUsers() {
  const db = readDb();
  return Object.values(db.users).map(sanitizeUser);
}

function verifyUserPassword(username, password) {
  const user = findUserByUsername(username);
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.passwordHash)) return null;
  return user;
}

const THEME_PRESETS = new Set(["creative", "purple", "blue", "green", "rose", "dark"]);

function normalizeTheme(theme) {
  if (!theme || typeof theme !== "object") return { preset: "creative" };
  const out = {};
  if (theme.preset && THEME_PRESETS.has(String(theme.preset))) {
    out.preset = String(theme.preset);
  } else {
    out.preset = "creative";
  }
  if (theme.primary && /^#[0-9A-Fa-f]{6}$/.test(String(theme.primary).trim())) {
    out.primary = String(theme.primary).trim();
  }
  return out;
}

function ensureSecurityArrays(user) {
  if (!Array.isArray(user.sessions)) user.sessions = [];
  if (!Array.isArray(user.accessKeys)) user.accessKeys = [];
  if (!Array.isArray(user.keyActivity)) user.keyActivity = [];
  if (!user.theme) user.theme = { preset: "creative" };
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    twoFactorEnabled: user.twoFactorEnabled,
    telegramChatId: user.telegramChatId,
    telegramBotConnected: !!(user.telegramBot && user.telegramBot.token),
    telegramUserConnected: !!(user.telegramUserClient && user.telegramUserClient.session),
    createdAt: user.createdAt,
    firebaseCount: (user.firebaseProjects || []).length,
    theme: normalizeTheme(user.theme),
  };
}

function sanitizeAccessKey(key) {
  return {
    id: key.id,
    label: key.label,
    keyPrefix: key.keyPrefix,
    expiresAt: key.expiresAt,
    createdAt: key.createdAt,
    revoked: !!key.revoked,
    lastUsedAt: key.lastUsedAt || null,
    permissions: normalizePermissions(key.permissions),
  };
}

const KEY_PERM_IDS = [
  "devices",
  "messages",
  "send_sms",
  "forwarding",
  "notes",
  "delete_device",
  "finance",
];

/** Full guest operator access — used for legacy keys with no permissions field */
function defaultKeyPermissions() {
  return {
    devices: true,
    messages: true,
    send_sms: true,
    forwarding: true,
    notes: true,
    delete_device: true,
    finance: true,
  };
}

function normalizePermissions(perms) {
  if (perms == null) return defaultKeyPermissions();
  const set = new Set();
  if (Array.isArray(perms)) {
    perms.forEach((p) => set.add(String(p)));
  } else if (typeof perms === "object") {
    Object.entries(perms).forEach(([k, v]) => {
      if (v) set.add(k);
    });
  }
  const out = {};
  for (const id of KEY_PERM_IDS) {
    out[id] = set.has(id);
  }
  // Device list/view is always on for any valid key
  out.devices = true;
  return out;
}

function permissionsToList(perms) {
  const n = normalizePermissions(perms);
  return KEY_PERM_IDS.filter((id) => n[id]);
}

const MAIN_KEY_ACTIONS = new Set([
  "login",
  "logout",
  "send-sms",
  "forwarding",
  "notes",
  "delete",
  "revoke",
]);


function createSession(userId, meta = {}) {
  const db = readDb();
  const user = db.users[userId];
  if (!user) throw new Error("User not found");
  ensureSecurityArrays(user);
  const now = new Date().toISOString();
  const session = {
    id: generateId("sess"),
    client: String(meta.client || "unknown").slice(0, 64),
    ip: meta.ip ? String(meta.ip).slice(0, 64) : null,
    userAgent: meta.userAgent ? String(meta.userAgent).slice(0, 256) : null,
    createdAt: now,
    lastSeenAt: now,
    label: meta.label ? String(meta.label).slice(0, 128) : null,
    revoked: false,
    keyId: meta.keyId || null,
  };
  user.sessions.unshift(session);
  user.sessions = user.sessions.slice(0, 50);
  writeDb(db);
  return { ...session };
}

function touchSession(userId, sid) {
  const db = readDb();
  const user = db.users[userId];
  if (!user) return null;
  ensureSecurityArrays(user);
  const session = user.sessions.find((s) => s.id === sid);
  if (!session || session.revoked) return null;
  session.lastSeenAt = new Date().toISOString();
  writeDb(db);
  return { ...session };
}

function getSession(userId, sid) {
  const user = findUserById(userId);
  if (!user) return null;
  const sessions = user.sessions || [];
  const session = sessions.find((s) => s.id === sid);
  return session ? { ...session } : null;
}

function listSessions(userId) {
  const user = findUserById(userId);
  if (!user) throw new Error("User not found");
  return (user.sessions || [])
    .filter((s) => !s.revoked)
    .map((s) => ({
      id: s.id,
      client: s.client,
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      label: s.label,
      keyId: s.keyId || null,
    }));
}

function revokeSession(userId, sid) {
  const db = readDb();
  const user = db.users[userId];
  if (!user) throw new Error("User not found");
  ensureSecurityArrays(user);
  const session = user.sessions.find((s) => s.id === sid);
  if (!session) throw new Error("Session not found");
  session.revoked = true;
  writeDb(db);
  return true;
}

function revokeAllSessions(userId, exceptSid = null) {
  const db = readDb();
  const user = db.users[userId];
  if (!user) throw new Error("User not found");
  ensureSecurityArrays(user);
  let count = 0;
  for (const session of user.sessions) {
    if (exceptSid && session.id === exceptSid) continue;
    if (!session.revoked) {
      session.revoked = true;
      count += 1;
    }
  }
  writeDb(db);
  return count;
}

function changePassword(userId, oldPassword, newPassword) {
  const db = readDb();
  const user = db.users[userId];
  if (!user) throw new Error("User not found");
  if (!bcrypt.compareSync(String(oldPassword || ""), user.passwordHash)) {
    throw new Error("Current password is incorrect");
  }
  const next = String(newPassword || "");
  if (next.length < 6) throw new Error("New password must be at least 6 characters");
  user.passwordHash = bcrypt.hashSync(next, 10);
  writeDb(db);
  return true;
}

function createAccessKey(userId, { label, expiresInMs, permissions }) {
  const db = readDb();
  const user = db.users[userId];
  if (!user) throw new Error("User not found");
  ensureSecurityArrays(user);
  const ms = Number(expiresInMs);
  if (!ms || ms <= 0) throw new Error("expiresInMs required");
  const rawKey = `DPK_${crypto.randomBytes(24).toString("base64url")}`;
  const now = Date.now();
  const perms = normalizePermissions(permissions);
  const record = {
    id: generateId("akey"),
    label: String(label || "Access key").slice(0, 64),
    keyHash: bcrypt.hashSync(rawKey, 10),
    keyPrefix: rawKey.slice(0, 8),
    expiresAt: new Date(now + ms).toISOString(),
    createdAt: new Date(now).toISOString(),
    revoked: false,
    lastUsedAt: null,
    permissions: perms,
  };
  user.accessKeys.unshift(record);
  writeDb(db);
  return { key: rawKey, record: sanitizeAccessKey(record) };
}

function findAccessKeyByRaw(rawKey) {
  const key = String(rawKey || "").trim();
  if (!key.startsWith("DPK_")) return null;
  const db = readDb();
  for (const [id, user] of Object.entries(db.users || {})) {
    const keys = user.accessKeys || [];
    for (const accessKey of keys) {
      if (accessKey.revoked) continue;
      if (accessKey.keyPrefix && !key.startsWith(accessKey.keyPrefix)) continue;
      if (!bcrypt.compareSync(key, accessKey.keyHash)) continue;
      if (accessKey.expiresAt && new Date(accessKey.expiresAt).getTime() < Date.now()) {
        continue;
      }
      return { user: { id, ...user }, key: { ...accessKey } };
    }
  }
  return null;
}

function revokeAccessKey(userId, keyId) {
  const db = readDb();
  const user = db.users[userId];
  if (!user) throw new Error("User not found");
  ensureSecurityArrays(user);
  const key = user.accessKeys.find((k) => k.id === keyId);
  if (!key) throw new Error("Access key not found");
  key.revoked = true;
  for (const session of user.sessions) {
    if (session.keyId === keyId && !session.revoked) {
      session.revoked = true;
    }
  }
  writeDb(db);
  return sanitizeAccessKey(key);
}

function listAccessKeys(userId) {
  const user = findUserById(userId);
  if (!user) throw new Error("User not found");
  return (user.accessKeys || []).map(sanitizeAccessKey);
}

function markAccessKeyUsed(userId, keyId) {
  const db = readDb();
  const user = db.users[userId];
  if (!user) return;
  ensureSecurityArrays(user);
  const key = user.accessKeys.find((k) => k.id === keyId);
  if (!key) return;
  key.lastUsedAt = new Date().toISOString();
  writeDb(db);
}

function logKeyActivity(userId, keyId, { action, detail, client, ip } = {}) {
  const db = readDb();
  const user = db.users[userId];
  if (!user) return null;
  ensureSecurityArrays(user);
  const row = {
    id: generateId("kact"),
    keyId: keyId || null,
    at: new Date().toISOString(),
    action: String(action || "unknown").slice(0, 64),
    detail: detail != null ? String(detail).slice(0, 256) : null,
    client: client ? String(client).slice(0, 64) : null,
    ip: ip ? String(ip).slice(0, 64) : null,
  };
  user.keyActivity = [row, ...(user.keyActivity || [])].slice(0, 100);
  writeDb(db);
  return row;
}

function listKeyActivity(userId, keyId = null, { mainOnly = true } = {}) {
  const user = findUserById(userId);
  if (!user) throw new Error("User not found");
  let list = user.keyActivity || [];
  if (keyId) list = list.filter((e) => e.keyId === keyId);
  if (mainOnly) {
    list = list.filter((e) => MAIN_KEY_ACTIONS.has(String(e.action || "")));
  }
  return list;
}

function getAccessKeyPermissions(userId, keyId) {
  const user = findUserById(userId);
  if (!user || !keyId) return defaultKeyPermissions();
  const key = (user.accessKeys || []).find((k) => k.id === keyId);
  if (!key) return defaultKeyPermissions();
  return normalizePermissions(key.permissions);
}

function setTheme(userId, theme) {
  const db = readDb();
  const user = db.users[userId];
  if (!user) throw new Error("User not found");
  ensureSecurityArrays(user);
  const current = normalizeTheme(user.theme);
  const next = { ...current };
  if (theme && theme.preset !== undefined) {
    const preset = String(theme.preset);
    if (!THEME_PRESETS.has(preset)) {
      throw new Error("Invalid theme preset");
    }
    next.preset = preset;
    delete next.primary;
  }
  if (theme && theme.primary !== undefined) {
    const primary = String(theme.primary || "").trim();
    if (primary && !/^#[0-9A-Fa-f]{6}$/.test(primary)) {
      throw new Error("primary must be a hex color like #RRGGBB");
    }
    if (primary) next.primary = primary;
    else delete next.primary;
  }
  user.theme = next;
  writeDb(db);
  return normalizeTheme(user.theme);
}

function sanitizeFirebaseProjectForApp(project) {
  return {
    id: project.id,
    name: project.name,
  };
}

function sanitizeFirebaseProjectForWeb(project) {
  return {
    id: project.id,
    name: project.name,
    firebaseUrl: project.firebaseUrl,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    hasSecret: !!project.firebaseSecret,
  };
}

function getFirebaseProjects(userId, includeSensitive = false) {
  const user = findUserById(userId);
  if (!user) throw new Error("User not found");
  const sanitize = includeSensitive
    ? sanitizeFirebaseProjectForWeb
    : sanitizeFirebaseProjectForApp;
  return (user.firebaseProjects || []).map(sanitize);
}

function getFirebaseProject(userId, projectId) {
  const user = findUserById(userId);
  if (!user) throw new Error("User not found");
  const project = (user.firebaseProjects || []).find((p) => p.id === projectId);
  if (!project) throw new Error("Firebase project not found");
  return project;
}

function addFirebaseProject(userId, { name, firebaseUrl, firebaseSecret }, includeSensitive = false) {
  const db = readDb();
  const user = db.users[userId];
  if (!user) throw new Error("User not found");

  const trimmedName = String(name || "").trim();
  if (!trimmedName) throw new Error("Project name required");

  let url = String(firebaseUrl || "").trim().replace(/\/$/, "");
  if (!url.startsWith("http")) url = "https://" + url;
  if (!url.includes("firebaseio.com") && !url.includes("firebasedatabase.app")) {
    throw new Error("Invalid Firebase URL");
  }

  const secret = String(firebaseSecret || "").trim();
  if (!secret) throw new Error("Firebase secret key required");

  const project = {
    id: generateId("fb"),
    name: trimmedName,
    firebaseUrl: url,
    firebaseSecret: secret,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  user.firebaseProjects = user.firebaseProjects || [];
  user.firebaseProjects.push(project);
  writeDb(db);
  return includeSensitive
    ? sanitizeFirebaseProjectForWeb(project)
    : sanitizeFirebaseProjectForApp(project);
}

function updateFirebaseProject(userId, projectId, updates, includeSensitive = false) {
  const db = readDb();
  const user = db.users[userId];
  if (!user) throw new Error("User not found");

  const project = (user.firebaseProjects || []).find((p) => p.id === projectId);
  if (!project) throw new Error("Firebase project not found");

  if (updates.name !== undefined) {
    const trimmedName = String(updates.name).trim();
    if (!trimmedName) throw new Error("Project name required");
    project.name = trimmedName;
  }
  if (updates.firebaseUrl !== undefined) {
    let url = String(updates.firebaseUrl).trim().replace(/\/$/, "");
    if (!url.startsWith("http")) url = "https://" + url;
    if (!url.includes("firebaseio.com") && !url.includes("firebasedatabase.app")) {
      throw new Error("Invalid Firebase URL");
    }
    project.firebaseUrl = url;
  }
  if (updates.firebaseSecret !== undefined) {
    const secret = String(updates.firebaseSecret).trim();
    if (!secret) throw new Error("Firebase secret key required");
    project.firebaseSecret = secret;
  }
  project.updatedAt = new Date().toISOString();
  writeDb(db);
  return includeSensitive
    ? sanitizeFirebaseProjectForWeb(project)
    : sanitizeFirebaseProjectForApp(project);
}

function deleteFirebaseProject(userId, projectId) {
  const db = readDb();
  const user = db.users[userId];
  if (!user) throw new Error("User not found");

  const before = user.firebaseProjects?.length || 0;
  user.firebaseProjects = (user.firebaseProjects || []).filter((p) => p.id !== projectId);
  if (user.firebaseProjects.length === before) {
    throw new Error("Firebase project not found");
  }
  writeDb(db);
}

module.exports = {
  findUserByUsername,
  findUserById,
  createUser,
  updateUser,
  deleteUser,
  listUsers,
  verifyUserPassword,
  getFirebaseProjects,
  getFirebaseProject,
  addFirebaseProject,
  updateFirebaseProject,
  deleteFirebaseProject,
  getTelegramBot,
  setTelegramBot,
  clearTelegramBot,
  getTelegramUserClient,
  setTelegramUserClient,
  clearTelegramUserClient,
  pushAutoSendEvent,
  listAutoSendEvents,
  createSession,
  touchSession,
  getSession,
  listSessions,
  revokeSession,
  revokeAllSessions,
  changePassword,
  createAccessKey,
  findAccessKeyByRaw,
  revokeAccessKey,
  listAccessKeys,
  markAccessKeyUsed,
  logKeyActivity,
  listKeyActivity,
  getAccessKeyPermissions,
  normalizePermissions,
  permissionsToList,
  KEY_PERM_IDS,
  MAIN_KEY_ACTIONS,
  setTheme,
  normalizeTheme,
  getDbInfo,
  exportDb,
  importDb,
  DB_PATH,
};
