import express from "express";
import multer from "multer";
import {
  createPaste,
  deletePaste,
  downloadPaste,
  getPaste,
  getUserPastes,
  previewPaste,
} from "../controllers/paste.controller.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

router.get("/user/:userId", getUserPastes);
router.post("/", upload.single("file"), createPaste);
router.get("/:slug/download", downloadPaste);
router.get("/:slug/preview", previewPaste);
router.delete("/:slug", deletePaste);
router.get("/:slug", getPaste);

export default router;
