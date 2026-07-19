const express = require("express");
const { pool } = require("../lib/db");
const { requireAdmin, hashPassword } = require("../lib/auth");
const { proratedFirstMonthFee, lateFineFor, lastDayOfMonthISO, daysUntilNextMonthStart, ADVANCE_REFUND } = require("../lib/fees");

const router = express.Router();

async function getHallBySlug(orgId, slug) {
  const r = await pool.query("SELECT * FROM halls WHERE organization_id = $1 AND slug = $2", [orgId, slug]);
  return r.rows[0];
}

// List halls with live occupancy counts
router.get("/", requireAdmin, async (req, res) => {
  const halls = await pool.query("SELECT * FROM halls WHERE organization_id = $1 ORDER BY name", [req.admin.organizationId]);
  const withCounts = await Promise.all(
    halls.rows.map(async (h) => {
      const total = await pool.query("SELECT COUNT(*) FROM seats WHERE hall_id = $1", [h.id]);
      const filled = await pool.query("SELECT COUNT(*) FROM students WHERE hall_id = $1", [h.id]);
      return { ...h, totalSeats: Number(total.rows[0].count), occupiedSeats: Number(filled.rows[0].count) };
    })
  );
  res.json(withCounts);
});

// Full seat grid with any assigned student for that hall
router.get("/:slug/seats", requireAdmin, async (req, res) => {
  const hall = await getHallBySlug(req.admin.organizationId, req.params.slug);
  if (!hall) return res.status(404).json({ error: "Hall not found" });
  const result = await pool.query(
    `SELECT s.seat_number, s.is_locker, s.fee_amount, s.advance_amount,
            st.id AS student_id, st.name, st.mobile, st.fee_paid, st.expiry_date, st.vacating, st.vacate_effective_date
     FROM seats s
     LEFT JOIN students st ON st.seat_id = s.id
     WHERE s.hall_id = $1
     ORDER BY s.seat_number`,
    [hall.id]
  );
  res.json({ hall, seats: result.rows });
});

// Full detail for one seat (includes photos, aadhar, etc — admin only)
router.get("/:slug/seats/:seatNumber", requireAdmin, async (req, res) => {
  const hall = await getHallBySlug(req.admin.organizationId, req.params.slug);
  if (!hall) return res.status(404).json({ error: "Hall not found" });
  const seatRes = await pool.query("SELECT * FROM seats WHERE hall_id = $1 AND seat_number = $2", [hall.id, req.params.seatNumber]);
  const seat = seatRes.rows[0];
  if (!seat) return res.status(404).json({ error: "Seat not found" });
  const studentRes = await pool.query("SELECT * FROM students WHERE seat_id = $1", [seat.id]);
  res.json({ seat, student: studentRes.rows[0] || null });
});

// Admin manually assigns a student to a vacant seat
router.post("/:slug/seats/:seatNumber/assign", requireAdmin, async (req, res) => {
  const {
    name, mobile, aadhar, dob, gender, email, password, photoUrl, aadharPhotoUrl, paymentMethod,
    qualification, category, occupation, guardianName, guardianOccupation, guardianMobile, address, pincode,
  } = req.body;
  if (!name || !/^\d{10}$/.test(mobile || "")) return res.status(400).json({ error: "Name and a 10-digit mobile number are required" });
  if (aadhar && !/^\d{12}$/.test(aadhar)) return res.status(400).json({ error: "Aadhar number must be exactly 12 digits" });

  const hall = await getHallBySlug(req.admin.organizationId, req.params.slug);
  if (!hall) return res.status(404).json({ error: "Hall not found" });
  const seatRes = await pool.query("SELECT * FROM seats WHERE hall_id = $1 AND seat_number = $2", [hall.id, req.params.seatNumber]);
  const seat = seatRes.rows[0];
  if (!seat) return res.status(404).json({ error: "Seat not found" });

  const existing = await pool.query("SELECT id FROM students WHERE seat_id = $1", [seat.id]);
  if (existing.rows.length) return res.status(409).json({ error: "That seat is already occupied" });

  const join = new Date();
  const prorate = proratedFirstMonthFee(join, Number(seat.fee_amount));
  const feeAmount = Number(seat.advance_amount) + prorate.amount;
  const expiry = new Date(); expiry.setDate(prorate.dim);
  const passwordHash = await hashPassword(password || mobile.slice(-4));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const studentRes = await client.query(
      `INSERT INTO students (hall_id, seat_id, name, dob, gender, mobile, email, aadhar_number, photo_url, aadhar_photo_url,
                              password_hash, qualification, category, occupation, guardian_name, guardian_occupation,
                              guardian_mobile, address, pincode, fee_amount, fee_paid, join_date, expiry_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,true,$21,$22) RETURNING *`,
      [hall.id, seat.id, name, dob || null, gender || null, mobile, email || null, aadhar || null, photoUrl || null, aadharPhotoUrl || null,
       passwordHash, qualification || null, category || null, occupation || null, guardianName || null, guardianOccupation || null,
       guardianMobile || null, address || null, pincode || null, feeAmount, join.toISOString().slice(0, 10), expiry.toISOString().slice(0, 10)]
    );
    await client.query(
      `INSERT INTO payments (hall_id, student_id, seat_number, amount, method, status, type, confirmed_at)
       VALUES ($1,$2,$3,$4,$5,'confirmed','joining', now())`,
      [hall.id, studentRes.rows[0].id, seat.seat_number, feeAmount, paymentMethod === "upi" ? "upi" : "cash"]
    );
    await client.query("COMMIT");
    res.json({ student: studentRes.rows[0], feeBreakdown: prorate });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "Could not assign seat" });
  } finally {
    client.release();
  }
});

// Admin edits a student's details
router.put("/:slug/seats/:seatNumber", requireAdmin, async (req, res) => {
  const hall = await getHallBySlug(req.admin.organizationId, req.params.slug);
  if (!hall) return res.status(404).json({ error: "Hall not found" });
  const { name, mobile, aadhar, dob, gender, notes, address } = req.body;
  const result = await pool.query(
    `UPDATE students SET name=$1, mobile=$2, aadhar_number=$3, dob=$4, gender=$5, notes=$6, address=$7, updated_at=now()
     WHERE hall_id=$8 AND seat_id = (SELECT id FROM seats WHERE hall_id=$8 AND seat_number=$9)
     RETURNING *`,
    [name, mobile, aadhar, dob || null, gender || null, notes || null, address || null, hall.id, req.params.seatNumber]
  );
  if (!result.rows.length) return res.status(404).json({ error: "No student on that seat" });
  res.json(result.rows[0]);
});

// Vacate immediately (admin action, no notice-period check)
router.delete("/:slug/seats/:seatNumber", requireAdmin, async (req, res) => {
  const hall = await getHallBySlug(req.admin.organizationId, req.params.slug);
  if (!hall) return res.status(404).json({ error: "Hall not found" });
  await pool.query(
    `DELETE FROM students WHERE hall_id=$1 AND seat_id = (SELECT id FROM seats WHERE hall_id=$1 AND seat_number=$2)`,
    [hall.id, req.params.seatNumber]
  );
  res.json({ ok: true });
});

// Admin-initiated renewal (cash, confirmed immediately) or UPI (creates a payment order — see /api/payments)
router.post("/:slug/seats/:seatNumber/renew", requireAdmin, async (req, res) => {
  const { months, method } = req.body;
  const hall = await getHallBySlug(req.admin.organizationId, req.params.slug);
  if (!hall) return res.status(404).json({ error: "Hall not found" });
  const seatRes = await pool.query("SELECT * FROM seats WHERE hall_id=$1 AND seat_number=$2", [hall.id, req.params.seatNumber]);
  const seat = seatRes.rows[0];
  const studentRes = await pool.query("SELECT * FROM students WHERE seat_id=$1", [seat?.id]);
  const student = studentRes.rows[0];
  if (!seat || !student) return res.status(404).json({ error: "No student on that seat" });

  const fine = lateFineFor(new Date());
  const amount = Number(seat.fee_amount) * Number(months || 1) + fine;

  if (method === "upi") {
    // Real gateway flow — client should call /api/payments/create-order with type=renewal
    return res.json({ requiresGatewayOrder: true, amount, fine });
  }

  const base = student.expiry_date && new Date(student.expiry_date) > new Date() ? new Date(student.expiry_date) : new Date();
  base.setMonth(base.getMonth() + Number(months || 1));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE students SET expiry_date=$1, fee_paid=true, updated_at=now() WHERE id=$2", [base.toISOString().slice(0, 10), student.id]);
    await client.query(
      `INSERT INTO payments (hall_id, student_id, seat_number, amount, method, status, type, confirmed_at)
       VALUES ($1,$2,$3,$4,'cash','confirmed','renewal', now())`,
      [hall.id, student.id, seat.seat_number, amount]
    );
    await client.query("COMMIT");
    res.json({ ok: true, newExpiry: base.toISOString().slice(0, 10), amount, fine });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "Renewal failed" });
  } finally {
    client.release();
  }
});

// Reports: today's / this month's collection, fee-due list, fee-paid list
router.put("/:slug/upi", requireAdmin, async (req, res) => {
  const { upiId } = req.body;
  const hall = await getHallBySlug(req.admin.organizationId, req.params.slug);
  if (!hall) return res.status(404).json({ error: "Hall not found" });
  await pool.query("UPDATE halls SET upi_id = $1 WHERE id = $2", [upiId, hall.id]);
  res.json({ ok: true });
});

router.get("/:slug/reports", requireAdmin, async (req, res) => {
  const hall = await getHallBySlug(req.admin.organizationId, req.params.slug);
  if (!hall) return res.status(404).json({ error: "Hall not found" });

  const today = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE hall_id=$1 AND status='confirmed' AND created_at::date = CURRENT_DATE`,
    [hall.id]
  );
  const month = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE hall_id=$1 AND status='confirmed' AND date_trunc('month', created_at) = date_trunc('month', CURRENT_DATE)`,
    [hall.id]
  );
  const paidList = await pool.query(`SELECT s.seat_number, st.name, st.fee_amount FROM students st JOIN seats s ON s.id = st.seat_id WHERE st.hall_id=$1 AND st.fee_paid = true ORDER BY s.seat_number`, [hall.id]);
  const dueList = await pool.query(`SELECT s.seat_number, st.name, st.fee_amount FROM students st JOIN seats s ON s.id = st.seat_id WHERE st.hall_id=$1 AND st.fee_paid = false ORDER BY s.seat_number`, [hall.id]);
  const totalDue = dueList.rows.reduce((sum, r) => sum + Number(r.fee_amount), 0);

  res.json({
    todayCollection: Number(today.rows[0].total),
    monthCollection: Number(month.rows[0].total),
    paidList: paidList.rows,
    dueList: dueList.rows,
    totalDue,
  });
});

module.exports = router;
