const jwt = require("jsonwebtoken");

function getJwtSecret() {
  return process.env.JWT_SECRET || "change-me-in-production";
}

function createToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: "user" },
    getJwtSecret(),
    { expiresIn: "7d" }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    req.user = jwt.verify(token, getJwtSecret());
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
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

module.exports = { createToken, authMiddleware, getUserProject };
