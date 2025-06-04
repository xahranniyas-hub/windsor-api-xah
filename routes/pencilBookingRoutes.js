// routes/pencilBookingRoutes.js
import express from "express";
import {
  createPencilBooking,
  listActivePencilBookings,
  convertPencilBooking,
  expirePencilBooking,
  deletePencilBooking,
} from "../controllers/pencilBookingController.js";
import { protect, authorizeRole } from "../middleware/authMiddleware.js";

const router = express.Router();

// POST /api/pencil-bookings  (Editor or Admin)
router.post(
  "/",
  protect,
  authorizeRole(["calendar", "editor", "admin"]),
  createPencilBooking
);

// GET /api/pencil-bookings   (View all active)
router.get(
  "/",
  protect,
  authorizeRole(["calendar", "editor", "admin"]),
  listActivePencilBookings
);

// PATCH /api/pencil-bookings/:id/convert
router.patch(
  "/:id/convert",
  protect,
  authorizeRole(["editor", "admin"]),
  convertPencilBooking
);

// PATCH /api/pencil-bookings/:id/expire  (Expire a booking)
router.patch(
  "/:id/expire",
  protect,
  authorizeRole(["editor", "admin"]),
  expirePencilBooking
);

// DELETE /api/pencil-bookings/:id   (Delete a booking)
router.delete(
  "/:id",
  protect,
  authorizeRole(["editor", "admin"]),
  deletePencilBooking
);

export default router;
