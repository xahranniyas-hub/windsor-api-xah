// controllers/bookingController.js
import Booking from "../models/bookingModel.js";
import { getNextSequenceValue } from "../utils/getNextSequenceValue.js";

/* ─────────────────────────────────────────  Helpers ── */
const calcTotalAdvance = (adv = []) =>
  adv.reduce((sum, p) => sum + Number(p.amount || 0), 0);

/* ─────────────────────────────────────────  READS ── */
export const getAllBookings = async (req, res) => {
  try {
    const { status, search } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (search)
      filter["customerInfo.phone"] = { $regex: search, $options: "i" };

    const bookings = await Booking.find(filter).sort({ createdAt: -1 });
    return res.json(bookings);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const getBookingById = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    return res.json(booking);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────  PAYMENTS ── */
export const addAdvancePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, reference, description, mode, amount } = req.body;

    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const seq = await getNextSequenceValue("advancePayments");
    const serialNumber = `AP${String(seq).padStart(6, "0")}`;

    booking.advancePayments.push({
      date,
      serialNumber,
      reference,
      description,
      mode,
      amount,
    });

    booking.balanceDue -= amount;
    await booking.save();

    return res.json(booking);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

export const receivePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, reference, description, mode, amount } = req.body;

    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const seq = await getNextSequenceValue("advancePayments");
    const serialNumber = `PY${String(seq).padStart(6, "0")}`;

    booking.advancePayments.push({
      date,
      serialNumber,
      reference,
      description,
      mode,
      amount,
    });

    booking.balanceDue -= amount;
    await booking.save();

    return res.json(booking);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────  UPDATE ── */
export const updateBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    /* Updatable fields */
    if (req.body.customerInfo) booking.customerInfo = req.body.customerInfo;
    if (req.body.date) booking.date = req.body.date;
    if (req.body.timeSlot) booking.timeSlot = req.body.timeSlot;
    if (req.body.ballrooms) booking.ballrooms = req.body.ballrooms; // <-- array!
    if (req.body.foodMenu) booking.foodMenu = req.body.foodMenu;
    if (req.body.foodMenuCost) booking.foodMenuCost = req.body.foodMenuCost;
    if (req.body.indicativePricing !== undefined)
      booking.indicativePricing = req.body.indicativePricing;

    if (req.body.discount !== undefined) {
      booking.discount = req.body.discount;
      booking.approvedDiscount = false; // reset approval
    }

    /* Re-calculate balance due */
    booking.balanceDue =
      booking.indicativePricing - calcTotalAdvance(booking.advancePayments);

    await booking.save();
    return res.json(booking);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────  FINAL INVOICE ── */
export const generateFinalInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    let { invoiceNumber, additionalIncome } = req.body;

    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (!invoiceNumber) {
      const seq = await getNextSequenceValue("invoices");
      invoiceNumber = `IN${String(seq).padStart(6, "0")}`;
    }

    const addIncomeTotal = (additionalIncome || []).reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0
    );

    const subtotal = Number(booking.indicativePricing) + addIncomeTotal;
    const vat = 0; // change if needed
    const total = subtotal + vat;

    const totalAdvance = calcTotalAdvance(booking.advancePayments);
    const balanceDue = total - totalAdvance;

    booking.finalInvoice = {
      invoiceNumber,
      dateIssued: new Date(),
      lineItems: additionalIncome || [],
      subtotal,
      vat,
      total,
      balanceDue,
    };

    booking.balanceDue = balanceDue;
    booking.status = "completed";

    await booking.save();
    return res.json({ message: "Final invoice updated", booking });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────  STATUS CHANGES ── */
export const closeBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { isFullySettled } = req.body;

    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    booking.status = isFullySettled ? "completed" : "partially_closed";
    await booking.save();

    return res.json({
      message: "Booking status updated",
      status: booking.status,
    });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

export const deleteBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    await booking.deleteOne();
    return res.json({ message: "Booking deleted successfully" });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};
