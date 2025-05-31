/*
 * models/bookingModel.js – v3  (extra costs moved outside finalInvoice)
 * -------------------------------------------------------------------*/
import mongoose from "mongoose";
const { Schema, model } = mongoose;

/* ----------------------------------------------------
 * Shared sub‑documents
 * --------------------------------------------------*/
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

const PaymentDetailsSchema = new Schema(
  {
    date: { type: Date, required: true },
    serialNumber: { type: String, required: true },
    reference: { type: String, required: true },
    description: { type: String, required: true },
    mode: {
      type: String,
      enum: ["cash", "bank transfer", "cheque", "deposit"],
      required: true,
    },
    amount: { type: Number, required: true },
  },
  { _id: false }
);

/* one line‑item: coffee, corkage, damages, … */
const CostLineItemSchema = new Schema(
  {
    type: { type: String },
    description: { type: String },
    cost: { type: Number },
    quantity: { type: Number },
    amount: { type: Number, required: true },
  },
  { _id: false }
);

/* Final invoice – now *without* lineItems; they are copied in later */
const FinalInvoiceSchema = new Schema(
  {
    invoiceNumber: { type: String },
    dateIssued: { type: Date },
    subtotal: { type: Number },
    vat: { type: Number },
    total: { type: Number },
  },
  { toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

FinalInvoiceSchema.virtual("status").get(function () {
  const booking = this.parent();
  return booking && booking.balanceDue > 0 ? "Open" : "Settled";
});

const BallroomSubSchema = new Schema(
  {
    name: { type: String, enum: ["Grand", "Diamond", "Royal"], required: true },
    guests: { type: Number, min: 1, required: true },
  },
  { _id: false }
);

/* ----------------------------------------------------
 * Booking – main schema
 * --------------------------------------------------*/
const BookingSchema = new Schema(
  {
    pencilBookingId: { type: Schema.Types.ObjectId, ref: "PencilBooking" },

    serialNumber: { type: String, unique: true },

    status: {
      type: String,
      enum: ["confirmed", "completed", "partially_closed", "cancelled"],
      default: "confirmed",
      required: true,
    },

    ballrooms: { type: [BallroomSubSchema], required: true },

    date: { type: Date, required: true },
    timeSlot: { type: String, enum: ["Lunch", "Dinner"], required: true },

    /* ---------- custom time (required) ---------- */
    customTime: { type: TimeDurationSchema, required: true },

    customerInfo: {
      name: { type: String, required: true },
      phone: { type: String, required: true },
      email: { type: String },
      NIC: { type: String, required: true },
      address: { type: String, required: true },
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
      required: true,
    },
    foodMenuCost: { type: Number, required: true },
    indicativePricing: { type: Number, required: true },

    discount: { type: Number },
    approvedDiscount: { type: Boolean, default: false, required: true },

    advancePayments: { type: [PaymentDetailsSchema], default: [] },

    /* Requested deposit, payments against it, and what’s still outstanding */
    refundableDepositDue: { type: Number, default: 0 }, // ← NEW
    refundableDepositPayments: { type: [PaymentDetailsSchema], default: [] },
    refundableDepositOutstanding: { type: Number, default: 0 }, // ← NEW (kept in sync)
    refundDueToCustomer: { type: Number, default: 0 },
    depositCollected: { type: Number, default: 0 }, // NEW
    depositUsed: { type: Number, default: 0 }, // NEW

    /* ------------------------------------------------
     * Extra cost line‑items captured at *creation*
     * ------------------------------------------------*/
    additionalCosts: { type: [CostLineItemSchema], default: [] },

    /* ------------------------------------------------
     * Income buckets (unchanged)
     * ------------------------------------------------*/
    additionalIncome: {
      type: [
        {
          description: { type: String, required: true },
          amount: { type: Number, required: true },
          dateAdded: { type: Date, default: Date.now, required: true },
        },
      ],
      default: [],
    },

    foodIncome: {
      type: [
        {
          memoId: {
            type: Schema.Types.ObjectId,
            ref: "FoodMemo",
            required: true,
          },
          description: { type: String, required: true },
          amount: { type: Number, required: true },
          dateAdded: { type: Date, default: Date.now, required: true },
        },
      ],
      default: [],
    },

    /* Final invoice (totals) */
    finalInvoice: FinalInvoiceSchema,

    balanceDue: { type: Number, default: 0 },

    /* reschedule / cancel */
    rescheduleRequest: {
      requestedDate: { type: Date },
      reason: { type: String },
      status: {
        type: String,
        enum: ["pending", "approved", "rejected"],
        default: "pending",
      },
    },
    cancellationRequest: {
      reason: { type: String },
      status: {
        type: String,
        enum: ["pending", "approved", "rejected"],
        default: "pending",
      },
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

/* ----------------------------------------------------
 * Validators – ensure start < end
 * --------------------------------------------------*/
BookingSchema.pre("validate", function (next) {
  const t = this.customTime;
  if (t) {
    const [sH, sM] = t.start.split(":").map(Number);
    const [eH, eM] = t.end.split(":").map(Number);
    if (sH * 60 + sM >= eH * 60 + eM) {
      return next(
        new Error("customTime.start must be earlier than customTime.end")
      );
    }
  }
  next();
});

BookingSchema.pre("save", function (next) {
  const pos = this.refundableDepositPayments
    .filter((p) => p.amount > 0)
    .reduce((s, p) => s + p.amount, 0);
  this.refundableDepositOutstanding = Math.max(
    0,
    (this.refundableDepositDue || 0) - pos
  );
  next();
});

export default model("Booking", BookingSchema);
