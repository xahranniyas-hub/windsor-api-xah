import mongoose from "mongoose";
const { Schema, model } = mongoose;

/* helper — works for same-day or cross-midnight (“next-day”) ranges */
function durationMinutes(startHHMM, endHHMM) {
  const [sH, sM] = startHHMM.split(":").map(Number);
  const [eH, eM] = endHHMM.split(":").map(Number);

  const start = sH * 60 + sM;
  let end = eH * 60 + eM;

  // if the clock-time looks earlier, treat it as ‘next day’
  if (end <= start) end += 24 * 60;

  return end - start; // always positive
}

const MAX_EVENT_MINUTES = 12 * 60; // 12 h sanity cap

/* ----------------------------------------------------
 * Sub‑documents
 * --------------------------------------------------*/
const BallroomSubSchema = new Schema(
  {
    name: { type: String, enum: ["Grand", "Diamond", "Royal"], required: true },
    guests: { type: Number, min: 1, required: true },
  },
  { _id: false }
);

// Optional custom time range when the default Lunch/Dinner windows
// don’t fit the event (e.g. 19:00‑23:00)
const TimeDurationSchema = new Schema(
  {
    start: {
      type: String, // HH:mm, 24‑hour
      required: true,
      match: /^([0-1]?\d|2[0-3]):[0-5]\d$/,
    },
    end: {
      type: String,
      required: true,
      match: /^([0-1]?\d|2[0-3]):[0-5]\d$/,
    },
  },
  { _id: false }
);

/* ----------------------------------------------------
 * Main schema
 * --------------------------------------------------*/
const PencilBookingSchema = new Schema(
  {
    serialNumber: { type: String, unique: true },

    date: { type: Date, required: true },
    timeSlot: { type: String, enum: ["Lunch", "Dinner"], required: true },

    // ⇣ Optional override for the standard Lunch/Dinner window ⇣
    customTime: { type: TimeDurationSchema },

    /* ---------- multiple ballrooms ---------- */
    ballrooms: { type: [BallroomSubSchema], required: true },

    customerInfo: {
      name: { type: String, required: true },
      phone: { type: String, required: true },
      email: { type: String },
      NIC: { type: String },
    },

    foodMenu: {
      type: String,
      enum: [
        "A1_Full",
        "A1_Half",
        "A2_Full",
        "A2_Half",
        "A3_Full",
        "A3_Half",
        "A4_Full",
        "A4_Half",
        "A5_Full",
        "A5_Half",
        "Bronze_Full",
        "Bronze_Half",
        "Silver_Full",
        "Silver_Half",
        "Gold_Full",
        "Gold_Half",
        "Platinum_Full",
        "Platinum_Half",
        "Customized_Menu",
      ],
    },
    /* ✨ NEW ✨ */
    menuDescription: {
      type: String,
      trim: true,
      maxlength: 1_000, // tweak as you like
    },
    foodMenuCost: { type: Number },
    indicativePricing: { type: Number },

    status: {
      type: String,
      enum: ["active", "expired", "converted"],
      default: "active",
    },
    expiryDate: { type: Date, required: true },
  },
  { timestamps: true }
);

/* ----------------------------------------------------
 * Validators & hooks
 * --------------------------------------------------*/
PencilBookingSchema.pre("validate", function (next) {
  if (this.customTime) {
    const { start, end } = this.customTime;
    const dur = durationMinutes(start, end);

    if (dur <= 0)
      return next(
        new Error("customTime.end must be later than customTime.start")
      );

    if (dur > MAX_EVENT_MINUTES)
      return next(
        new Error(
          `Custom time range is too long (${(dur / 60).toFixed(
            1
          )} h). Maximum allowed is ${MAX_EVENT_MINUTES / 60} h.`
        )
      );
  }
  next();
});

export default model("PencilBooking", PencilBookingSchema);
