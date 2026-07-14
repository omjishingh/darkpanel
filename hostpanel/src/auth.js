const jwt = require("jsonwebtoken");

function getSecret() {
  return process.env.JWT_SECRET || "change-me";
}

function createToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username },
    getSecret(),
    { expiresIn: "7d" }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.user = jwt.verify(token, getSecret());
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { createToken, authMiddleware };
