import mongoose from "mongoose";
const { Schema, model } = mongoose;

/** Helper: minutes between two HH:mm strings (overnight wraps) */
function durationMinutes(startHHMM, endHHMM) {
  const [sH, sM] = startHHMM.split(":").map(Number);
  const [eH, eM] = endHHMM.split(":").map(Number);
  const start = sH * 60 + sM;
  let end = eH * 60 + eM;
  if (end <= start) end += 24 * 60;
  return end - start; // always positive
}

const MAX_EVENT_MINUTES = 12 * 60; // 12h cap

/**** Sub-Schemas ****/
const BallroomSubSchema = new Schema(
  {
    name: { type: String, enum: ["Grand", "Diamond", "Royal"], required: true },
    guests: { type: Number, min: 1, required: true },
  },
  { _id: false }
);

const TimeDurationSchema = new Schema(
  {
    start: {
      type: String,
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

const CostLineItemSchema = new Schema(
  {
    type: { type: String, trim: true },
    description: { type: String, trim: true },
    cost: { type: Number, min: 0 },
    quantity: { type: Number, min: 0 },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

/**** Main Quotation Schema ****/
const QuotationSchema = new Schema(
  {
    // 1) Every quotation must have a serial number. You’ll generate this manually
    serialNumber: { type: String, required: true, unique: true },

    // 2) Date + slot
    date: { type: Date, required: true },
    timeSlot: { type: String, enum: ["Lunch", "Dinner"], required: true },

    // 3) Optional customTime override for Lunch/Dinner
    customTime: { type: TimeDurationSchema },

    // 4) At least one ballroom
    ballrooms: { type: [BallroomSubSchema], required: true },

    // 5) Customer info
    customerInfo: {
      name: { type: String, required: true, trim: true },
      phone: { type: String, required: true, trim: true },
      email: { type: String, trim: true },
      NIC: { type: String, trim: true }, // make “required: true” if you need strict NIC capture
    },

    // 6) Menu selection
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
        "Chicken_Biriyani",
        "Beef_Biriyani",
        "Mutton_Biriyani",
        "Hall_Only",
        "Ghee_Rice",
        "Customized_Menu",
      ],
      required: true,
    },

    // 7) If they chose “Customized_Menu,” they describe it here:
    menuDescription: { type: String, trim: true, maxlength: 1000 },

    // 8) Cost fields
    foodMenuCost: { type: Number, min: 0 },
    additionalCosts: { type: [CostLineItemSchema], default: [] },
    indicativePricing: { type: Number, min: 0 },

    // 9) Status (active/expired/converted)
    status: {
      type: String,
      enum: ["active", "expired", "converted"],
      default: "active",
    },

    // 10) If you want auto-expiry, reintroduce expiryDate here:
    // expiryDate: { type: Date, required: true },
  },
  { timestamps: true }
);

/**** Compound Index to Speed Up Conflict Checks ****/
QuotationSchema.index(
  { date: 1, timeSlot: 1, "ballrooms.name": 1 },
  { name: "DateSlotBallroomIndex" }
);

/**** Pre-validation Hook ****/
QuotationSchema.pre("validate", function (next) {
  // 1) Validate customTime if provided
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
          `Custom time range too long (${(dur / 60).toFixed(
            1
          )}h). Max allowed is ${MAX_EVENT_MINUTES / 60}h.`
        )
      );
  }

  // 2) If you re-introduce expiryDate, validate it here:
  // if (this.expiryDate <= this.date) {
  //   return next(new Error("expiryDate must be after the event date"));
  // }

  // 3) If foodMenu === "Customized_Menu", require description & cost:
  if (this.foodMenu === "Customized_Menu") {
    if (!this.menuDescription || this.foodMenuCost == null) {
      return next(
        new Error("Customized_Menu requires menuDescription and foodMenuCost")
      );
    }
  }

  next();
});

export default model("Quotation", QuotationSchema);
