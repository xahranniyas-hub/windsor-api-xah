// controllers/pencilBookingController.js
import PencilBooking from "../models/pencilBookingModel.js";
import Booking from "../models/bookingModel.js";
import { getNextSequenceValue } from "../utils/getNextSequenceValue.js";

const ALLOWED_BALLROOMS = ["Grand", "Diamond", "Royal"];

/* ────────────────────────────────────────────────────────── *
 *  Shared helpers
 * ────────────────────────────────────────────────────────── */
function validateBallroomArray(ballrooms = []) {
  if (!Array.isArray(ballrooms) || ballrooms.length === 0) {
    return "Select at least one ballroom.";
  }
  for (const { name, guests } of ballrooms) {
    if (!ALLOWED_BALLROOMS.includes(name)) return `Invalid ballroom: ${name}`;
    if (!guests || guests <= 0)
      return `Guests for ballroom ${name} must be greater than 0.`;
  }
  return null; // OK
}

/* Check clashes for one date / timeSlot against EVERY ballroom in the list */
async function hasConflict({ date, timeSlot, ballrooms, ignoreId = null }) {
  for (const { name } of ballrooms) {
    // A) Confirmed bookings
    const confirmed = await Booking.findOne({
      "ballrooms.name": name,
      date,
      timeSlot,
      status: { $ne: "cancelled" },
    });
    if (confirmed) return `Ballroom ${name} is already permanently booked.`;

    // B) Active pencil bookings (optionally ignore the current doc)
    const activePencil = await PencilBooking.findOne({
      _id: ignoreId ? { $ne: ignoreId } : { $exists: true },
      "ballrooms.name": name,
      date,
      timeSlot,
      status: "active",
    });
    if (activePencil)
      return `An active pencil booking already exists for ballroom ${name}.`;
  }
  return null; // no conflict
}

/* ────────────────────────────────────────────────────────── *
 *  1. Create Pencil Booking
 * ────────────────────────────────────────────────────────── */
export const createPencilBooking = async (req, res) => {
  try {
    const {
      date,
      timeSlot,
      ballrooms,
      customerInfo,
      foodMenu,
      foodMenuCost,
      indicativePricing,
    } = req.body;

    /* 1️⃣  Validate ballrooms */
    const ballroomErr = validateBallroomArray(ballrooms);
    if (ballroomErr) return res.status(400).json({ message: ballroomErr });

    /* 2️⃣  Conflicts */
    const conflictMsg = await hasConflict({ date, timeSlot, ballrooms });
    if (conflictMsg) return res.status(400).json({ message: conflictMsg });

    /* 3️⃣  Generate bookkeeping fields */
    const expiryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000); // +7 days
    const seq = await getNextSequenceValue("pencilBookings");
    const serialNumber = `PN${String(seq).padStart(6, "0")}`;

    /* 4️⃣  Create */
    const pencil = await PencilBooking.create({
      serialNumber,
      date,
      timeSlot,
      ballrooms,
      customerInfo,
      foodMenu,
      foodMenuCost,
      indicativePricing,
      expiryDate,
    });

    return res.status(201).json(pencil);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/* ────────────────────────────────────────────────────────── *
 *  2. List Pencil Bookings  (unchanged except for field names)
 * ────────────────────────────────────────────────────────── */
export const listActivePencilBookings = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status
      ? { status: { $in: status.split(",") } }
      : { status: { $in: ["active", "converted", "expired"] } };

    const bookings = await PencilBooking.find(filter);
    return res.json(bookings);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/* ────────────────────────────────────────────────────────── *
 *  3. Convert Pencil → Permanent Booking
 * ────────────────────────────────────────────────────────── */
export const convertPencilBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      date,
      timeSlot,
      ballrooms,
      customerInfo,
      discount,
      advancePayments = [],
      refundableDepositPayments = [],
      foodMenu,
      foodMenuCost,
      indicativePricing,
    } = req.body;

    /* 1️⃣  Validate ballrooms */
    const ballroomErr = validateBallroomArray(ballrooms);
    if (ballroomErr) return res.status(400).json({ message: ballroomErr });

    /* 2️⃣  Validate numeric fields */
    if (foodMenuCost <= 0)
      return res.status(400).json({ message: "Food menu cost must be > 0." });
    if (indicativePricing <= 0)
      return res
        .status(400)
        .json({ message: "Indicative pricing must be > 0." });

    /* 3️⃣  Check sums for payments */
    const totalAdvance = advancePayments.reduce(
      (s, { amount = 0 }) => s + amount,
      0
    );
    const totalDeposit = refundableDepositPayments.reduce(
      (s, { amount = 0 }) => s + amount,
      0
    );
    if (totalAdvance <= 0)
      return res.status(400).json({ message: "Advance must be > 0." });
    if (totalDeposit <= 0)
      return res.status(400).json({ message: "Deposit must be > 0." });
    if (totalAdvance > indicativePricing)
      return res.status(400).json({ message: "Advance exceeds total cost." });

    /* 4️⃣  Locate pencil booking */
    const pencil = await PencilBooking.findById(id);
    if (!pencil) return res.status(404).json({ message: "Pencil not found." });
    if (pencil.status !== "active")
      return res.status(400).json({ message: "Pencil booking is not active." });

    /* 5️⃣  Conflict checks */
    const conflictMsg = await hasConflict({
      date,
      timeSlot,
      ballrooms,
      ignoreId: pencil._id,
    });
    if (conflictMsg) return res.status(400).json({ message: conflictMsg });

    /* 6️⃣  Serial numbers for payments */
    for (const p of advancePayments) {
      if (!p.serialNumber) {
        const seq = await getNextSequenceValue("advancePayments");
        p.serialNumber = `AP${String(seq).padStart(6, "0")}`;
      }
    }
    for (const p of refundableDepositPayments) {
      if (!p.serialNumber) {
        const seq = await getNextSequenceValue("refundableDepositPayments");
        p.serialNumber = `RP${String(seq).padStart(6, "0")}`;
      }
    }

    /* 7️⃣  Serial for permanent booking */
    const seq = await getNextSequenceValue("permanentBookings");
    const serialNumber = `BK${String(seq).padStart(6, "0")}`;

    /* 8️⃣  Create permanent booking */
    const newBooking = await Booking.create({
      pencilBookingId: pencil._id,
      serialNumber,
      date,
      timeSlot,
      ballrooms,
      customerInfo,
      foodMenu,
      foodMenuCost,
      indicativePricing,
      discount,
      advancePayments,
      refundableDepositPayments,
      balanceDue: indicativePricing - totalAdvance,
      refundDueToCustomer: totalDeposit,
      status: "confirmed",
    });

    /* 9️⃣  Update pencil status */
    pencil.status = "converted";
    await pencil.save();

    return res.json(newBooking);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/* ────────────────────────────────────────────────────────── *
 *  4. Expire Pencil Booking
 * ────────────────────────────────────────────────────────── */
export const expirePencilBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await PencilBooking.findById(id);
    if (!booking)
      return res.status(404).json({ message: "Pencil booking not found." });
    if (booking.status !== "active")
      return res
        .status(400)
        .json({ message: "Only active bookings can expire." });

    booking.status = "expired";
    await booking.save();

    return res.json({ message: "Pencil booking expired.", booking });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/* ────────────────────────────────────────────────────────── *
 *  5. Delete Pencil Booking
 * ────────────────────────────────────────────────────────── */
export const deletePencilBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await PencilBooking.findById(id);
    if (!booking)
      return res.status(404).json({ message: "Pencil booking not found." });

    await booking.deleteOne();
    return res.json({ message: "Pencil booking deleted successfully." });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};
