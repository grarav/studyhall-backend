const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

const uploadDir = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

// NOTE: this stores files on local disk, which is fine for development but
// NOT for production (files vanish on redeploy). Swap this handler for an
// S3 / Cloudflare R2 upload (e.g. using @aws-sdk/client-s3) before going live —
// the rest of the app only cares that this returns a stable URL.
router.post("/", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  res.json({ url: `/uploads/${req.file.filename}` });
});

module.exports = router;
