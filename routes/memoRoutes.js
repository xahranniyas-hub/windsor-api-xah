// routes/memoRoutes.js
import express from "express";
import {
  createMemo,
  getMemosForBooking,
} from "../controllers/memoController.js";
import { protect, authorizeRole } from "../middleware/authMiddleware.js";

const router = express.Router();

// POST /api/memos - create a new partial payment memo
router.post("/", protect, authorizeRole(["editor", "admin"]), createMemo);

// GET /api/memos/:bookingId - list memos for a booking
router.get(
  "/:bookingId",
  protect,
  authorizeRole(["editor", "admin", "viewer"]),
  getMemosForBooking
);

export default router;
