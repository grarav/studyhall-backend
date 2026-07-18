const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

async function hashPassword(pw) {
  return bcrypt.hash(pw, 10);
}
async function verifyPassword(pw, hash) {
  return bcrypt.compare(pw, hash);
}
function signToken(payload, expiresIn = "7d") {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}
function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch (e) { return null; }
}

// Express middleware: requires a valid admin JWT
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = token && verifyToken(token);
  if (!payload || payload.type !== "admin") return res.status(401).json({ error: "Unauthorized" });
  req.admin = payload;
  next();
}

// Express middleware: requires a valid admin JWT with master role
function requireMaster(req, res, next) {
  requireAdmin(req, res, () => {
    if (req.admin.role !== "master") return res.status(403).json({ error: "Master admin only" });
    next();
  });
}

// Express middleware: requires a valid student JWT
function requireStudent(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = token && verifyToken(token);
  if (!payload || payload.type !== "student") return res.status(401).json({ error: "Unauthorized" });
  req.student = payload;
  next();
}

const PASSWORD_RULES = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
function isStrongPassword(pw) {
  return PASSWORD_RULES.test(pw || "");
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, requireAdmin, requireMaster, requireStudent, isStrongPassword };
