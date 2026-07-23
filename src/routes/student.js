const express = require("express");
const { pool } = require("../lib/db");
isValidStudentPassword
const { hashPassword, verifyPassword, signToken, requireStudent, isStrongPassword } = require("../lib/auth");
const { proratedFirstMonthFee, daysUntilNextMonthStart, ADVANCE_REFUND, SEAT_CHANGE_FEE } = require("../lib/fees");

const router = express.Router();

// Step 1 of signup: given a hall, list vacant seats
router.get("/halls/:slug/vacant-seats", async (req, res) => {
  const hallRes = await pool.query("SELECT * FROM halls WHERE slug=$1", [req.params.slug]);
  const hall = hallRes.rows[0];
  if (!hall) return res.status(404).json({ error: "Hall not found" });
  const result = await pool.query(
    `SELECT s.seat_number, s.is_locker, s.fee_amount, s.advance_amount
     FROM seats s LEFT JOIN students st ON st.seat_id = s.id
     WHERE s.hall_id = $1 AND st.id IS NULL
     ORDER BY s.seat_number`,
    [hall.id]
  );
  res.json({ hallName: hall.name, upiId: hall.upi_id, seats: result.rows });
});

// Step 2 of signup: submit application for a chosen seat, after the student
// has paid via a gateway order created through /api/payments/create-order (type=signup)
router.post("/signup", async (req, res) => {
  const {
    hallSlug, seatNumber, name, dob, gender, mobile, aadhar, photoUrl, aadharPhotoUrl, password, gatewayPaymentId,
    email, qualification, category, occupation, guardianName, guardianOccupation, guardianMobile, address, pincode,
  } = req.body;
  if (!name || !dob || !gender || !/^\d{10}$/.test(mobile || "") || !/^\d{12}$/.test(aadhar || "") || !photoUrl || !aadharPhotoUrl) {
    return res.status(400).json({ error: "All fields are required, including both photos" });
  }
 if (!isValidStudentPassword(password)) {
    return res.status(400).json({ error: "Password must be at least 4 characters" });
  }
  const hallRes = await pool.query("SELECT * FROM halls WHERE slug=$1", [hallSlug]);
  const hall = hallRes.rows[0];
  if (!hall) return res.status(404).json({ error: "Hall not found" });
  const seatRes = await pool.query("SELECT * FROM seats WHERE hall_id=$1 AND seat_number=$2", [hall.id, seatNumber]);
  const seat = seatRes.rows[0];
  if (!seat) return res.status(404).json({ error: "Seat not found" });

  const join = new Date();
  const prorate = proratedFirstMonthFee(join, Number(seat.fee_amount));
  const feeAmount = Number(seat.advance_amount) + prorate.amount;
  const passwordHash = await hashPassword(password);

  const result = await pool.query(
    `INSERT INTO signup_applications (hall_id, seat_id_requested, name, dob, gender, mobile, email, aadhar_number, photo_url, aadhar_photo_url,
                                       password_hash, qualification, category, occupation, guardian_name, guardian_occupation, guardian_mobile,
                                       address, pincode, fee_amount, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'pending') RETURNING *`,
    [hall.id, seat.id, name, dob, gender, mobile, email || null, aadhar, photoUrl, aadharPhotoUrl, passwordHash,
     qualification || null, category || null, occupation || null, guardianName || null, guardianOccupation || null,
     guardianMobile || null, address || null, pincode || null, feeAmount]
  );
  // gatewayPaymentId is recorded via the payments table by /api/payments/verify — see that route.
  res.json({ application: result.rows[0], feeBreakdown: prorate });
});

router.post("/login", async (req, res) => {
  const { mobile, password } = req.body;
  const studentRes = await pool.query(
    `SELECT st.*, h.slug AS hall_slug, h.name AS hall_name, s.seat_number
     FROM students st JOIN halls h ON h.id = st.hall_id LEFT JOIN seats s ON s.id = st.seat_id
     WHERE st.mobile = $1`,
    [mobile]
  );
  const student = studentRes.rows[0];
  if (student && (await verifyPassword(password, student.password_hash))) {
    const token = signToken({ type: "student", id: student.id, hallId: student.hall_id, seatNumber: student.seat_number });
    return res.json({ token, status: "active", student: { name: student.name, hallSlug: student.hall_slug, hallName: student.hall_name, seatNumber: student.seat_number } });
  }
  // Reset password using mobile + Aadhar number as identity verification
router.post("/forgot-password", async (req, res) => {
  const { mobile, aadhar, newPassword } = req.body;
  if (!mobile || !aadhar || !newPassword) {
    return res.status(400).json({ error: "Mobile number, Aadhar number, and a new password are all required" });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ error: "Password must be at least 4 characters" });
  }
  const result = await pool.query(
    "SELECT id FROM students WHERE mobile = $1 AND aadhar_number = $2",
    [mobile, aadhar]
  );
  const student = result.rows[0];
  if (!student) {
    return res.status(404).json({ error: "No account found matching that mobile number and Aadhar number" });
  }
  const passwordHash = await hashPassword(newPassword);
  await pool.query("UPDATE students SET password_hash = $1 WHERE id = $2", [passwordHash, student.id]);
  res.json({ ok: true });
});
  // Not an active student — check pending applications
  const appRes = await pool.query(
    `SELECT sa.*, h.slug AS hall_slug, h.name AS hall_name FROM signup_applications sa JOIN halls h ON h.id = sa.hall_id WHERE sa.mobile = $1 AND sa.status = 'pending'`,
    [mobile]
  );
  const application = appRes.rows[0];
  if (application && (await verifyPassword(password, application.password_hash))) {
    return res.json({ status: "pending", application: { name: application.name, hallName: application.hall_name, submittedAt: application.created_at } });
  }
  res.status(401).json({ error: "No matching account found" });
});

router.get("/me", requireStudent, async (req, res) => {
  const result = await pool.query(
    `SELECT st.*, h.name AS hall_name, h.slug AS hall_slug, h.upi_id, s.seat_number
     FROM students st JOIN halls h ON h.id = st.hall_id LEFT JOIN seats s ON s.id = st.seat_id
     WHERE st.id = $1`,
    [req.student.id]
  );
  res.json(result.rows[0]);
});

// Request to change seat — student picks a vacant seat, pays ₹100 (via gateway), request queued for admin
router.post("/seat-change", requireStudent, async (req, res) => {
  const { toSeatNumber } = req.body;
  const meRes = await pool.query("SELECT * FROM students WHERE id=$1", [req.student.id]);
  const me = meRes.rows[0];
  const toSeatRes = await pool.query("SELECT * FROM seats WHERE hall_id=$1 AND seat_number=$2", [me.hall_id, toSeatNumber]);
  const toSeat = toSeatRes.rows[0];
  if (!toSeat) return res.status(404).json({ error: "Seat not found" });
  const occupied = await pool.query("SELECT id FROM students WHERE seat_id=$1", [toSeat.id]);
  if (occupied.rows.length) return res.status(409).json({ error: "That seat is no longer vacant" });

  const result = await pool.query(
    `INSERT INTO seat_change_requests (student_id, from_seat_id, to_seat_id, amount, status)
     VALUES ($1,$2,$3,$4,'pending') RETURNING *`,
    [me.id, me.seat_id, toSeat.id, SEAT_CHANGE_FEE]
  );
  res.json(result.rows[0]);
});

// Request to vacate — refund eligibility computed server-side from today's date
router.post("/vacate", requireStudent, async (req, res) => {
  const meRes = await pool.query("SELECT * FROM students WHERE id=$1", [req.student.id]);
  const me = meRes.rows[0];
  const eligible = daysUntilNextMonthStart(new Date()) >= 7;
  const result = await pool.query(
    `INSERT INTO vacate_requests (student_id, refund_eligible, refund_amount, status)
     VALUES ($1,$2,$3,'pending') RETURNING *`,
    [me.id, eligible, eligible ? ADVANCE_REFUND : 0]
  );
  res.json(result.rows[0]);
});

module.exports = router;
