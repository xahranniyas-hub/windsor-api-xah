// models/bookingModel.js
import mongoose from "mongoose";
const { Schema, model } = mongoose;

/* ───────────────────────────────────────── Payment & Invoice ── */
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

const FinalInvoiceLineItemSchema = new Schema(
  {
    type: { type: String }, // Coffee, Damages, …
    description: { type: String },
    cost: { type: Number }, // NEW
    quantity: { type: Number }, // NEW
    amount: { type: Number, required: true },
  },
  { _id: false }
);

const FinalInvoiceSchema = new Schema(
  {
    invoiceNumber: { type: String },
    dateIssued: { type: Date },
    lineItems: [FinalInvoiceLineItemSchema], // use the new schema
    subtotal: { type: Number },
    vat: { type: Number },
    total: { type: Number },
  },
  { toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

FinalInvoiceSchema.virtual("status").get(function () {
  const booking = this.parent(); // parent document
  return booking && booking.balanceDue > 0 ? "Open" : "Settled";
});

/* ───────────────────────────────────────── Ballroom sub-schema ── */
const BallroomSubSchema = new Schema(
  {
    name: { type: String, enum: ["Grand", "Diamond", "Royal"], required: true },
    guests: { type: Number, min: 1, required: true },
  },
  { _id: false }
);

/* ───────────────────────────────────────── Booking ── */
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

    /** ⇣ MULTIPLE BALLROOMS ⇣ **/
    ballrooms: { type: [BallroomSubSchema], required: true },

    date: { type: Date, required: true },
    timeSlot: { type: String, enum: ["Lunch", "Dinner"], required: true },

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

    indicativePricing: { type: Number, required: true }, // usually guests × cost/hd

    discount: { type: Number },
    approvedDiscount: { type: Boolean, default: false, required: true },

    advancePayments: { type: [PaymentDetailsSchema], default: [] },
    refundableDepositPayments: { type: [PaymentDetailsSchema], default: [] },

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

    finalInvoice: FinalInvoiceSchema,
    refundDueToCustomer: { type: Number, default: 0 },
    balanceDue: { type: Number, default: 0 },

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

export default model("Booking", BookingSchema);
