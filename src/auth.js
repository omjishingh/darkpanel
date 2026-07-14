const jwt = require("jsonwebtoken");
const db = require("./db");

function getJwtSecret() {
  return process.env.JWT_SECRET || "change-me-in-production";
}

/**
 * @param {object} user
 * @param {object} [extras]
 * @param {string} [extras.sid]
 * @param {"owner"|"guest"} [extras.scope]
 * @param {string} [extras.keyId]
 * @param {string} [extras.ownerId]
 * @param {string} [extras.guestSid]
 */
function createToken(user, extras = {}) {
  const scope = extras.scope === "guest" ? "guest" : "owner";
  const payload = {
    sub: user.id,
    username: user.username,
    role: "user",
    scope,
  };
  if (extras.sid) payload.sid = extras.sid;
  if (extras.keyId) payload.keyId = extras.keyId;
  if (extras.ownerId) payload.ownerId = extras.ownerId;
  if (extras.guestSid) payload.guestSid = extras.guestSid;
  if (scope === "guest" && extras.guestSid && !payload.sid) {
    payload.sid = extras.guestSid;
  }
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "7d" });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    const sid = decoded.sid || decoded.guestSid || null;
    if (sid) {
      const isGuest = decoded.scope === "guest";
      const userId = isGuest
        ? decoded.ownerId || decoded.sub
        : decoded.sub;
      const session = db.getSession(userId, sid);
      if (!session || session.revoked) {
        return res.status(401).json({ error: "Session revoked or expired" });
      }
      if (isGuest && decoded.keyId) {
        const user = db.findUserById(userId);
        const key = (user?.accessKeys || []).find((k) => k.id === decoded.keyId);
        if (!key || key.revoked) {
          return res.status(401).json({ error: "Access key revoked" });
        }
        if (key.expiresAt && new Date(key.expiresAt).getTime() < Date.now()) {
          return res.status(401).json({ error: "Access key expired" });
        }
        decoded.permissions = db.normalizePermissions(key.permissions);
      }
      try {
        db.touchSession(userId, sid);
      } catch (_) {}
    }
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireOwner(req, res, next) {
  if (req.user?.scope === "guest") {
    return res.status(403).json({ error: "Owner access required" });
  }
  next();
}

/** Guest must have permission; owners always pass */
function requireKeyPerm(perm) {
  return (req, res, next) => {
    if (req.user?.scope !== "guest") return next();
    const perms = req.user.permissions || db.getAccessKeyPermissions(req.user.sub, req.user.keyId);
    if (!perms || !perms[perm]) {
      return res.status(403).json({ error: `Permission denied: ${perm}` });
    }
    next();
  };
}

function requireScope(...allowed) {
  const set = new Set(allowed);
  return (req, res, next) => {
    const scope = req.user?.scope || "owner";
    if (!set.has(scope)) {
      return res.status(403).json({ error: "Insufficient scope" });
    }
    next();
  };
}

function isServerAdminUser(username) {
  const hub = require("./serverHub");
  return hub.isServerAdmin(username);
}

function requireServerAdmin(req, res, next) {
  const hub = require("./serverHub");
  if (!hub.isEnabled()) {
    return res.status(403).json({ error: "Server Hub disabled on this host" });
  }
  if (!hub.isServerAdmin(req.user?.username)) {
    return res.status(403).json({ error: "Server admin access required" });
  }
  next();
}

function getUserProject(req, res) {
  const userId = req.user.sub;
  const projectId = req.params.projectId || req.query.projectId;
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return null;
  }
  return { userId, projectId };
}

module.exports = {
  createToken,
  authMiddleware,
  requireOwner,
  requireKeyPerm,
  requireScope,
  requireServerAdmin,
  isServerAdminUser,
  getUserProject,
};
