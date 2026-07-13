function getAdminKey() {
  return (process.env.ADMIN_KEY || "").trim();
}

function verifyAdminKey(key) {
  const adminKey = getAdminKey();
  if (!adminKey) return false;
  return key === adminKey;
}

function adminMiddleware(req, res, next) {
  const key =
    req.headers["x-admin-key"] ||
    req.body?.adminKey ||
    req.query?.adminKey;
  if (!verifyAdminKey(key)) {
    return res.status(403).json({ error: "Invalid or missing admin key" });
  }
  next();
}

module.exports = { verifyAdminKey, adminMiddleware, getAdminKey };
