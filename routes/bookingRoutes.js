// routes/bookingRoutes.js
import express from "express";
import { check, validationResult } from "express-validator";
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
  emailBookingPdf,
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

// (A) Public route to fetch a single booking, used only by the print‐page:
router.get("/public/:id", getBookingById);

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

// NEW: Email booking PDF (protected or not—up to you)
router.post(
  "/:id/email-pdf",
  protect, // ← if you want only logged‐in users to trigger this
  authorizeRole(["admin", "editor"]), // adjust as needed
  [check("id", "Invalid booking ID").isMongoId()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    return emailBookingPdf(req, res);
  }
);

export default router;
