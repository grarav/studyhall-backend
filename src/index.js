require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const adminRoutes = require("./routes/admin");
const hallRoutes = require("./routes/halls");
const studentRoutes = require("./routes/student");
const applicationRoutes = require("./routes/applications");
const paymentRoutes = require("./routes/payments");
const uploadRoutes = require("./routes/upload");

const app = express();

// Razorpay webhooks need the raw body for signature verification, so that
// route is mounted before the JSON body parser.
app.use("/api/payments/webhook", express.raw({ type: "*/*" }));

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.use("/api/admin", adminRoutes);
app.use("/api/halls", hallRoutes);
app.use("/api/student", studentRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/upload", uploadRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Study hall API listening on :${PORT}`));
