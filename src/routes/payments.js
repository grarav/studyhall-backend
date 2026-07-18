const express = require("express");
const { pool } = require("../lib/db");
const { createOrder, verifyPaymentSignature, verifyWebhookSignature } = require("../lib/payments");

const router = express.Router();

// Creates a Razorpay order for any payment type (joining/renewal/seat_change).
// The frontend uses the returned order to open Razorpay Checkout.
router.post("/create-order", async (req, res) => {
  const { amount, hallId, studentId, seatNumber, type } = req.body;
  try {
    const order = await createOrder(amount, `${type}_${Date.now()}`, { hallId, studentId, seatNumber, type });
    await pool.query(
      `INSERT INTO payments (hall_id, student_id, seat_number, amount, method, gateway_order_id, status, type)
       VALUES ($1,$2,$3,$4,'upi',$5,'pending',$6)`,
      [hallId, studentId || null, seatNumber || null, amount, order.id, type]
    );
    res.json({ order });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Called by the frontend immediately after a successful Razorpay Checkout.
// This is a convenience/UX step only — the webhook below is the real source of truth.
router.post("/verify", async (req, res) => {
  const { order_id, payment_id, signature } = req.body;
  const ok = verifyPaymentSignature({ order_id, payment_id, signature });
  if (!ok) return res.status(400).json({ error: "Signature mismatch — payment not verified" });
  await pool.query(
    `UPDATE payments SET gateway_payment_id=$1, gateway_signature=$2, status='confirmed', confirmed_at=now()
     WHERE gateway_order_id=$3`,
    [payment_id, signature, order_id]
  );
  res.json({ ok: true });
});

// Real server-to-server confirmation from Razorpay. Configure this URL in the
// Razorpay dashboard. This is what actually applies seat/expiry changes —
// never trust the client alone for money.
router.post("/webhook", async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  const raw = req.body; // express.raw() gives us a Buffer here
  if (!verifyWebhookSignature(raw.toString(), signature)) {
    return res.status(400).json({ error: "Invalid webhook signature" });
  }
  const event = JSON.parse(raw.toString());
  if (event.event === "payment.captured") {
    const orderId = event.payload.payment.entity.order_id;
    const paymentId = event.payload.payment.entity.id;
    await pool.query(
      `UPDATE payments SET gateway_payment_id=$1, status='confirmed', confirmed_at=now() WHERE gateway_order_id=$2`,
      [paymentId, orderId]
    );
    // NOTE: applying the actual seat/expiry/application change belongs here too,
    // keyed off payments.type — mirror the logic in routes/halls.js renew and
    // routes/applications.js confirm, triggered by this webhook instead of an
    // admin click, for the fully-automatic version of the flow.
  }
  res.json({ ok: true });
});

module.exports = router;
