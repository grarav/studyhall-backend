const express = require("express");
const { pool } = require("../lib/db");
const { hashPassword, verifyPassword, signToken, requireAdmin, isStrongPassword } = require("../lib/auth");

const router = express.Router();

// First admin created for an organization becomes 'master'; use an existing
// organization id, or omit to create a brand-new organization + master admin.
router.post("/signup", async (req, res) => {
  const { name, phone, email, password, organizationId, organizationName } = req.body;
  if (!name || !phone || !password) return res.status(400).json({ error: "name, phone, password are required" });
  if (!isStrongPassword(password)) {
    return res.status(400).json({ error: "Password must be 8+ chars with uppercase, lowercase, a number, and a special character" });
  }
  try {
    let orgId = organizationId;
    let role = "staff";
    if (!orgId) {
      const orgRes = await pool.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [organizationName || `${name}'s organization`]);
      orgId = orgRes.rows[0].id;
      role = "master";
    } else {
      const countRes = await pool.query("SELECT COUNT(*) FROM admin_users WHERE organization_id = $1", [orgId]);
      role = Number(countRes.rows[0].count) === 0 ? "master" : "staff";
    }
    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO admin_users (organization_id, name, phone, email, password_hash, role)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, phone, role, organization_id`,
      [orgId, name, phone, email || null, passwordHash, role]
    );
    const admin = result.rows[0];
    const token = signToken({ type: "admin", id: admin.id, organizationId: admin.organization_id, role: admin.role });
    res.json({ token, admin });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "An admin with this phone already exists in this organization" });
    console.error(e);
    res.status(500).json({ error: "Signup failed" });
  }
});

router.post("/login", async (req, res) => {
  const { phone, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM admin_users WHERE phone = $1", [phone]);
    const admin = result.rows[0];
    if (!admin || !(await verifyPassword(password, admin.password_hash))) {
      return res.status(401).json({ error: "Incorrect phone or password" });
    }
    const token = signToken({ type: "admin", id: admin.id, organizationId: admin.organization_id, role: admin.role });
    res.json({ token, admin: { id: admin.id, name: admin.name, phone: admin.phone, role: admin.role } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Login failed" });
  }
});

router.get("/me", requireAdmin, async (req, res) => {
  const result = await pool.query("SELECT id, name, phone, email, role FROM admin_users WHERE id = $1", [req.admin.id]);
  res.json(result.rows[0]);
});

// Master-only: list staff in the organization
router.get("/staff", requireAdmin, async (req, res) => {
  const result = await pool.query("SELECT id, name, phone, role FROM admin_users WHERE organization_id = $1 ORDER BY role, name", [req.admin.organizationId]);
  res.json(result.rows);
});

module.exports = router;
