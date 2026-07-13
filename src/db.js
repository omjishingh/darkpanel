const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const DB_PATH = process.env.DATA_PATH
  ? path.resolve(process.env.DATA_PATH)
  : path.join(__dirname, "..", "data", "accounts.json");

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
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
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

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    twoFactorEnabled: user.twoFactorEnabled,
    telegramChatId: user.telegramChatId,
    telegramBotConnected: !!(user.telegramBot && user.telegramBot.token),
    createdAt: user.createdAt,
    firebaseCount: (user.firebaseProjects || []).length,
  };
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
};
