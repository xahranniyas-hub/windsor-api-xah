// routes/bookingRoutes.js
import express from "express";
import {
  getAllBookings,
  getBookingById,
  updateBooking,
  generateFinalInvoice,
  closeBooking,
  addAdvancePayment,
  receivePayment,
  deleteBooking,
  refundDeposit,
  deletePayment,
  updatePayment,
} from "../controllers/bookingController.js";
import { protect, authorizeRole } from "../middleware/authMiddleware.js";

const router = express.Router();

// GET /api/bookings  (All bookings)
router.get(
  "/",
  protect,
  authorizeRole(["calendar", "admin", "editor", "viewer"]),
  getAllBookings
);

// GET /api/bookings/:id
router.get(
  "/:id",
  protect,
  authorizeRole(["calendar", "admin", "editor", "viewer"]),
  getBookingById
);

// PATCH /api/bookings/:id (update booking details: reschedule requests, discount, etc.)
router.patch(
  "/:id",
  protect,
  authorizeRole(["admin", "editor"]),
  updateBooking
);

// POST or PATCH – your preference
router.post("/:id/add-advance-payment", addAdvancePayment);

// PATCH /api/bookings/:id/final-invoice (generate/update final invoice)
// router.patch(
//   "/:id/final-invoice",
//   protect,
//   authorizeRole(["admin", "editor"]),
//   generateFinalInvoice
// );

// POST to receive a payment (using the same PaymentDetailsSchema)
router.post(
  "/:id/receive-payment",
  protect,
  authorizeRole(["admin", "editor"]),
  receivePayment
);

// POST /api/bookings/:id/generate-invoice (generate/update final invoice)
router.post(
  "/:id/generate-invoice",
  protect,
  authorizeRole(["admin", "editor"]),
  generateFinalInvoice
);

// POST /api/bookings/:id/generate-invoice (generate/update final invoice)
router.patch(
  "/:id/generate-invoice",
  protect,
  authorizeRole(["admin", "editor"]),
  generateFinalInvoice
);

// PATCH /api/bookings/:id/close (complete or partial close)
router.patch(
  "/:id/close",
  protect,
  authorizeRole(["admin", "editor"]),
  closeBooking
);

// DELETE /api/ookings/:id   (Delete a booking)
router.delete(
  "/:id",
  protect,
  authorizeRole(["editor", "admin"]),
  deleteBooking
);

// Refund deposit back to customer
router.post("/:id/refund-deposit", refundDeposit);

///api/bookings/:id/payments/:serial
router.delete("/:id/payments/:serial", deletePayment);

// edit payment
router.patch("/:id/payments/:serial", updatePayment);

export default router;
