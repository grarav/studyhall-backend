const crypto = require("crypto");
const Razorpay = require("razorpay");

let razorpay = null;
function getRazorpay() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return null;
  if (!razorpay) {
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpay;
}

// Creates a real Razorpay order for a UPI collection. Amount is in rupees; Razorpay wants paise.
async function createOrder(amountRupees, receipt, notes) {
  const rzp = getRazorpay();
  if (!rzp) throw new Error("Razorpay is not configured. Set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in .env");
  return rzp.orders.create({
    amount: Math.round(amountRupees * 100),
    currency: "INR",
    receipt,
    notes,
  });
}

// Verifies the signature Razorpay sends back after a successful checkout,
// so a payment can never be faked client-side.
function verifyPaymentSignature({ order_id, payment_id, signature }) {
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
    .update(`${order_id}|${payment_id}`)
    .digest("hex");
  return expected === signature;
}

// Verifies an incoming webhook's signature (separate secret, configured in the Razorpay dashboard).
function verifyWebhookSignature(rawBody, signatureHeader) {
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET || "")
    .update(rawBody)
    .digest("hex");
  return expected === signatureHeader;
}

module.exports = { getRazorpay, createOrder, verifyPaymentSignature, verifyWebhookSignature };
