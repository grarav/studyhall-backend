const express = require("express");
const { pool } = require("../lib/db");
const { requireAdmin } = require("../lib/auth");
const { lastDayOfMonthISO } = require("../lib/fees");

const router = express.Router();

// ---- Sign-up applications ----
router.get("/signups/:hallSlug", requireAdmin, async (req, res) => {
  const hallRes = await pool.query("SELECT * FROM halls WHERE organization_id=$1 AND slug=$2", [req.admin.organizationId, req.params.hallSlug]);
  const hall = hallRes.rows[0];
  if (!hall) return res.status(404).json({ error: "Hall not found" });
  const result = await pool.query(
    `SELECT sa.*, s.seat_number FROM signup_applications sa JOIN seats s ON s.id = sa.seat_id_requested
     WHERE sa.hall_id=$1 AND sa.status='pending' ORDER BY sa.created_at`,
    [hall.id]
  );
  res.json(result.rows);
});

router.post("/signups/:id/confirm", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const appRes = await client.query("SELECT * FROM signup_applications WHERE id=$1 AND status='pending' FOR UPDATE", [req.params.id]);
    const application = appRes.rows[0];
    if (!application) throw new Error("Application not found or already handled");

    const seatRes = await client.query("SELECT * FROM seats WHERE id=$1", [application.seat_id_requested]);
    const seat = seatRes.rows[0];
    const occupied = await client.query("SELECT id FROM students WHERE seat_id=$1", [seat.id]);
    if (occupied.rows.length) throw new Error(`Seat ${seat.seat_number} was taken in the meantime`);

    const join = new Date();
    const dim = new Date(join.getFullYear(), join.getMonth() + 1, 0).getDate();
    const expiry = new Date(); expiry.setDate(dim);

    const studentRes = await client.query(
      `INSERT INTO students (hall_id, seat_id, name, dob, gender, mobile, aadhar_number, photo_url, aadhar_photo_url,
                              password_hash, fee_amount, fee_paid, join_date, expiry_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$13) RETURNING *`,
      [application.hall_id, seat.id, application.name, application.dob, application.gender, application.mobile,
       application.aadhar_number, application.photo_url, application.aadhar_photo_url, application.password_hash,
       application.fee_amount, join.toISOString().slice(0, 10), expiry.toISOString().slice(0, 10)]
    );
    await client.query(
      `INSERT INTO payments (hall_id, student_id, seat_number, amount, method, status, type, confirmed_at)
       VALUES ($1,$2,$3,$4,'upi','confirmed','joining', now())`,
      [application.hall_id, studentRes.rows[0].id, seat.seat_number, application.fee_amount]
    );
    await client.query("UPDATE signup_applications SET status='confirmed' WHERE id=$1", [application.id]);
    await client.query("COMMIT");
    res.json({ ok: true, student: studentRes.rows[0] });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

router.post("/signups/:id/reject", requireAdmin, async (req, res) => {
  await pool.query("UPDATE signup_applications SET status='rejected' WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

// ---- Seat change requests ----
router.get("/seat-changes/:hallSlug", requireAdmin, async (req, res) => {
  const hallRes = await pool.query("SELECT * FROM halls WHERE organization_id=$1 AND slug=$2", [req.admin.organizationId, req.params.hallSlug]);
  const hall = hallRes.rows[0];
  const result = await pool.query(
    `SELECT r.*, st.name, fs.seat_number AS from_seat_number, ts.seat_number AS to_seat_number
     FROM seat_change_requests r
     JOIN students st ON st.id = r.student_id
     JOIN seats fs ON fs.id = r.from_seat_id
     JOIN seats ts ON ts.id = r.to_seat_id
     WHERE st.hall_id = $1 AND r.status='pending' ORDER BY r.created_at`,
    [hall.id]
  );
  res.json(result.rows);
});

router.post("/seat-changes/:id/confirm", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reqRes = await client.query("SELECT * FROM seat_change_requests WHERE id=$1 AND status='pending' FOR UPDATE", [req.params.id]);
    const changeReq = reqRes.rows[0];
    if (!changeReq) throw new Error("Request not found or already handled");
    const occupied = await client.query("SELECT id FROM students WHERE seat_id=$1", [changeReq.to_seat_id]);
    if (occupied.rows.length) throw new Error("Destination seat was taken in the meantime");

    const studentRes = await client.query("UPDATE students SET seat_id=$1, updated_at=now() WHERE id=$2 RETURNING *", [changeReq.to_seat_id, changeReq.student_id]);
    const toSeat = await client.query("SELECT seat_number FROM seats WHERE id=$1", [changeReq.to_seat_id]);
    await client.query(
      `INSERT INTO payments (hall_id, student_id, seat_number, amount, method, status, type, confirmed_at)
       VALUES ($1,$2,$3,$4,'upi','confirmed','seat_change', now())`,
      [studentRes.rows[0].hall_id, changeReq.student_id, toSeat.rows[0].seat_number, changeReq.amount]
    );
    await client.query("UPDATE seat_change_requests SET status='confirmed' WHERE id=$1", [changeReq.id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

router.post("/seat-changes/:id/reject", requireAdmin, async (req, res) => {
  await pool.query("UPDATE seat_change_requests SET status='rejected' WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

// ---- Vacate requests ----
router.get("/vacates/:hallSlug", requireAdmin, async (req, res) => {
  const hallRes = await pool.query("SELECT * FROM halls WHERE organization_id=$1 AND slug=$2", [req.admin.organizationId, req.params.hallSlug]);
  const hall = hallRes.rows[0];
  const result = await pool.query(
    `SELECT r.*, st.name, s.seat_number FROM vacate_requests r
     JOIN students st ON st.id = r.student_id JOIN seats s ON s.id = st.seat_id
     WHERE st.hall_id=$1 AND r.status='pending' ORDER BY r.created_at`,
    [hall.id]
  );
  res.json(result.rows);
});

router.post("/vacates/:id/confirm", requireAdmin, async (req, res) => {
  const reqRes = await pool.query("SELECT * FROM vacate_requests WHERE id=$1 AND status='pending'", [req.params.id]);
  const vacateReq = reqRes.rows[0];
  if (!vacateReq) return res.status(400).json({ error: "Request not found or already handled" });
  await pool.query(
    `UPDATE students SET vacating=true, vacate_effective_date=$1, refund_eligible=$2, refund_amount=$3, updated_at=now() WHERE id=$4`,
    [lastDayOfMonthISO(new Date()), vacateReq.refund_eligible, vacateReq.refund_amount, vacateReq.student_id]
  );
  await pool.query("UPDATE vacate_requests SET status='confirmed' WHERE id=$1", [vacateReq.id]);
  res.json({ ok: true });
});

router.post("/vacates/:id/reject", requireAdmin, async (req, res) => {
  await pool.query("UPDATE vacate_requests SET status='rejected' WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

// Finalize a scheduled vacate — actually frees the seat
router.post("/vacates/finalize/:studentId", requireAdmin, async (req, res) => {
  await pool.query("DELETE FROM students WHERE id=$1", [req.params.studentId]);
  res.json({ ok: true });
});

module.exports = router;
