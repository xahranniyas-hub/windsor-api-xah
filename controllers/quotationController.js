// controllers/quotationController.js
import Quotation from "../models/quotationModel.js";
import Booking from "../models/bookingModel.js";
import PencilBooking from "../models/pencilBookingModel.js";
import { getNextSequenceValue } from "../utils/getNextSequenceValue.js";

/** Helper: minutes between two HH:mm strings (overnight wraps) */
function durationMinutes(startHHMM, endHHMM) {
  const [sH, sM] = startHHMM.split(":").map(Number);
  const [eH, eM] = endHHMM.split(":").map(Number);
  const start = sH * 60 + sM;
  let end = eH * 60 + eM;
  if (end <= start) end += 24 * 60;
  return end - start; // always positive
}

const MAX_EVENT_MINUTES = 18 * 60; // 12h cap

/** exactly copied from pencil booking, plus one more check against existing quotations */
async function hasQuotationConflict({
  date,
  timeSlot,
  ballrooms,
  ignoreId = null,
}) {
  for (const { name } of ballrooms) {
    // A) Confirmed bookings
    const confirmed = await Booking.findOne({
      "ballrooms.name": name,
      date,
      timeSlot,
      status: { $ne: "cancelled" },
    });
    if (confirmed) return `Ballroom ${name} is already permanently booked.`;

    // B) Active pencil bookings
    const pencilConflict = await PencilBooking.findOne({
      _id: ignoreId ? { $ne: ignoreId } : { $exists: true },
      "ballrooms.name": name,
      date,
      timeSlot,
      status: "active",
    });
    if (pencilConflict)
      return `An active pencil booking already exists for ballroom ${name}.`;

    // C) Other active quotations
    const quoteQuery = {
      _id: ignoreId ? { $ne: ignoreId } : { $exists: true },
      "ballrooms.name": name,
      date,
      timeSlot,
      status: "active",
    };
    const existingQuote = await Quotation.findOne(quoteQuery).lean();
    if (existingQuote)
      return `Another active quotation already exists for ballroom ${name}.`;
  }
  return null; // no conflict
}

function validateBallroomArray(ballrooms = []) {
  const ALLOWED_BALLROOMS = ["Grand", "Diamond", "Royal"];
  if (!Array.isArray(ballrooms) || ballrooms.length === 0) {
    return "Select at least one ballroom.";
  }
  for (const { name, guests } of ballrooms) {
    if (!ALLOWED_BALLROOMS.includes(name)) return `Invalid ballroom: ${name}`;
    if (!guests || guests <= 0)
      return `Guests for ballroom ${name} must be greater than 0.`;
  }
  return null;
}

export const createQuotation = async (req, res) => {
  try {
    const {
      date,
      timeSlot,
      customTime,
      ballrooms,
      customerInfo,
      foodMenu,
      menuDescription,
      foodMenuCost,
      additionalCosts = [],
      indicativePricing,
    } = req.body;

    // 0) Validate customTime (copy same logic as pencil controller)
    if (customTime) {
      const HHMM = /^([0-1]?\d|2[0-3]):[0-5]\d$/;
      if (!HHMM.test(customTime.start) || !HHMM.test(customTime.end)) {
        return res
          .status(400)
          .json({ message: "customTime must be HH:mm 24-hour format." });
      }
      const dur = durationMinutes(customTime.start, customTime.end);
      if (dur <= 0) {
        return res
          .status(400)
          .json({ message: "Invalid custom time range (zero length)." });
      }
      if (dur > MAX_EVENT_MINUTES) {
        return res.status(400).json({
          message: `Custom time too long. Max ${MAX_EVENT_MINUTES / 60}h.`,
        });
      }
    }

    // 1) Validate ballrooms (reuse same helper as pencil booking)
    const ballroomErr = validateBallroomArray(ballrooms);
    if (ballroomErr) return res.status(400).json({ message: ballroomErr });

    // 2) Conflict check (against bookings, pencil bookings, other quotations)
    const conflictMsg = await hasQuotationConflict({
      date,
      timeSlot,
      ballrooms,
    });
    if (conflictMsg) return res.status(400).json({ message: conflictMsg });

    // 3) Optionally validate numeric fields (foodMenuCost, indicativePricing, additionalCosts)
    if (foodMenuCost == null || foodMenuCost < 0)
      return res.status(400).json({ message: "foodMenuCost must be ≥ 0." });
    if (indicativePricing == null || indicativePricing < 0)
      return res
        .status(400)
        .json({ message: "indicativePricing must be ≥ 0." });
    for (const [i, line] of additionalCosts.entries()) {
      // ① type must be present
      if (!line.type || !line.type.trim()) {
        return res
          .status(400)
          .json({ message: `Line-item #${i + 1}: “type” is required.` });
      }
      // ② cost × qty must produce a *positive* number
      if (line.amount == null || line.amount <= 0) {
        return res
          .status(400)
          .json({ message: `Line-item #${i + 1}: amount must be > 0.` });
      }
    }

    // 4) Generate serialNumber (e.g. “QT000123”)
    const seq = await getNextSequenceValue("quotations");
    const serialNumber = `QT${String(seq).padStart(6, "0")}`;

    // 5) OPTIONAL: If you want auto-expiry, compute expiryDate = now+7days
    // const expiryDate = new Date(Date.now() + 7*24*3600*1000);

    // 6) Create and return
    const newQuote = await Quotation.create({
      serialNumber,
      date,
      timeSlot,
      ...(customTime ? { customTime } : {}),
      ballrooms,
      customerInfo,
      foodMenu,
      menuDescription,
      foodMenuCost,
      additionalCosts,
      indicativePricing,
      // expiryDate,
      status: "active",
    });

    return res.status(201).json(newQuote);
  } catch (err) {
    console.error(err);
    return res.status(400).json({ message: err.message });
  }
};

/* ────────────────────────────────────────────────────────── *
 *  1. Get All Quotations
 * ────────────────────────────────────────────────────────── */
export const getAllQuotations = async (req, res) => {
  try {
    // Optionally filter by status query param: ?status=active,converted
    const { status } = req.query;
    let filter = {};
    if (status) {
      // Split comma-separated statuses, e.g. ?status=active,expired
      filter.status = { $in: status.split(",") };
    }

    const quotations = await Quotation.find(filter).sort({ date: 1 }).lean();
    return res.json(quotations);
  } catch (err) {
    console.error("Error in getAllQuotations:", err);
    return res
      .status(500)
      .json({ message: "Server error fetching quotations." });
  }
};

/* ────────────────────────────────────────────────────────── *
 *  2. Get Quotation by ID
 * ────────────────────────────────────────────────────────── */
export const getQuotationById = async (req, res) => {
  try {
    const { id } = req.params;
    const quotation = await Quotation.findById(id).lean();
    if (!quotation) {
      return res.status(404).json({ message: "Quotation not found." });
    }
    return res.json(quotation);
  } catch (err) {
    console.error("Error in getQuotationById:", err);
    // If cast to ObjectId fails, send 400
    if (err.name === "CastError") {
      return res.status(400).json({ message: "Invalid quotation ID." });
    }
    return res
      .status(500)
      .json({ message: "Server error fetching quotation." });
  }
};

/* ────────────────────────────────────────────────────────── *
 *  3. Update Quotation
 * ────────────────────────────────────────────────────────── */
export const updateQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      date,
      timeSlot,
      customTime,
      ballrooms,
      customerInfo,
      foodMenu,
      menuDescription,
      foodMenuCost,
      additionalCosts = [],
      indicativePricing,
      status,
    } = req.body;

    // 0) Ensure the quotation exists
    const existing = await Quotation.findById(id);
    if (!existing) {
      return res.status(404).json({ message: "Quotation not found." });
    }

    // 1) Validate customTime if supplied (reuse same logic as createQuotation)
    if (customTime) {
      const HHMM = /^([0-1]?\d|2[0-3]):[0-5]\d$/;
      if (!HHMM.test(customTime.start) || !HHMM.test(customTime.end)) {
        return res
          .status(400)
          .json({ message: "customTime must be HH:mm 24-hour format." });
      }
      const dur = durationMinutes(customTime.start, customTime.end);
      if (dur <= 0) {
        return res
          .status(400)
          .json({ message: "Invalid custom time range (zero length)." });
      }
      if (dur > MAX_EVENT_MINUTES) {
        return res.status(400).json({
          message: `Custom time too long. Max ${MAX_EVENT_MINUTES / 60}h.`,
        });
      }
    }

    // 2) Validate ballrooms
    const ballroomErr = validateBallroomArray(ballrooms);
    if (ballroomErr) return res.status(400).json({ message: ballroomErr });

    // 3) Conflict check (ignore the current quotation’s ID)
    const conflictMsg = await hasQuotationConflict({
      date,
      timeSlot,
      ballrooms,
      ignoreId: existing._id,
    });
    if (conflictMsg) return res.status(400).json({ message: conflictMsg });

    // 4) Validate numeric fields
    if (foodMenuCost == null || foodMenuCost < 0)
      return res.status(400).json({ message: "foodMenuCost must be ≥ 0." });
    if (indicativePricing == null || indicativePricing < 0)
      return res
        .status(400)
        .json({ message: "indicativePricing must be ≥ 0." });
    for (const [i, line] of additionalCosts.entries()) {
      // ① type must be present
      if (!line.type || !line.type.trim()) {
        return res
          .status(400)
          .json({ message: `Line-item #${i + 1}: “type” is required.` });
      }
      // ② cost × qty must produce a *positive* number
      if (line.amount == null || line.amount <= 0) {
        return res
          .status(400)
          .json({ message: `Line-item #${i + 1}: amount must be > 0.` });
      }
    }

    // 5) Apply updates
    existing.date = date;
    existing.timeSlot = timeSlot;
    existing.customTime = customTime || undefined;
    existing.ballrooms = ballrooms;
    existing.customerInfo = customerInfo;
    existing.foodMenu = foodMenu;
    existing.menuDescription = menuDescription;
    existing.foodMenuCost = foodMenuCost;
    existing.additionalCosts = additionalCosts;
    existing.indicativePricing = indicativePricing;
    if (status) existing.status = status; // allow status to be updated if provided

    // 6) Save and return updated document
    const updated = await existing.save();
    return res.json(updated);
  } catch (err) {
    console.error("Error in updateQuotation:", err);
    if (err.name === "CastError") {
      return res.status(400).json({ message: "Invalid quotation ID." });
    }
    return res.status(400).json({ message: err.message });
  }
};

/* ────────────────────────────────────────────────────────── *
 *  4. Delete Quotation
 * ────────────────────────────────────────────────────────── */
export const deleteQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    const quotation = await Quotation.findById(id);
    if (!quotation) {
      return res.status(404).json({ message: "Quotation not found." });
    }

    await quotation.deleteOne();
    return res.json({ message: "Quotation deleted successfully." });
  } catch (err) {
    console.error("Error in deleteQuotation:", err);
    if (err.name === "CastError") {
      return res.status(400).json({ message: "Invalid quotation ID." });
    }
    return res.status(400).json({ message: err.message });
  }
};
