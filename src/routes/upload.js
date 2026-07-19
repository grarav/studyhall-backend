const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const router = express.Router();

// Multer keeps the file in memory briefly, then we stream it straight to R2 —
// nothing touches local disk, so nothing gets lost on redeploy.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

router.post("/", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_BUCKET_NAME || !process.env.R2_PUBLIC_URL) {
    return res.status(500).json({ error: "File storage isn't configured yet (missing R2 environment variables)" });
  }

  // Optional folder field from the form (e.g. "profile-photos", "aadhar-cards") — keeps the bucket organized.
  const rawFolder = (req.body.folder || "misc").toString();
  const safeFolder = rawFolder.replace(/[^a-z0-9-]/gi, "").toLowerCase() || "misc";

  try {
    const key = `${safeFolder}/${Date.now()}_${crypto.randomBytes(6).toString("hex")}${path.extname(req.file.originalname)}`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    }));
    const url = `${process.env.R2_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
    res.json({ url });
  } catch (e) {
    console.error("R2 upload failed:", e);
    res.status(500).json({ error: "Upload failed" });
  }
});

module.exports = router;
