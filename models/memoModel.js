import mongoose from "mongoose";
const { Schema, model } = mongoose;

const MemoSchema = new Schema(
  {
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },
    // For partial/advance payments, you might store:
    memoNumber: String,
    dateIssued: { type: Date, default: Date.now },
    amountPaid: Number,
    paymentMethod: {
      type: String,
      enum: ["cash", "card", "bank_transfer", "cheque"],
      default: "cash",
    },
    // Possibly line items or just a single total for that payment
    notes: String,
  },
  { timestamps: true }
);

export default model("Memo", MemoSchema);
