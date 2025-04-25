// models/paymentModel.js
import mongoose from "mongoose";

const { Schema, model } = mongoose;

const PaymentSchema = new Schema(
  {
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    paymentType: {
      type: String,
      enum: ["advance", "deposit", "final", "misc"],
      required: true,
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "card", "bank_transfer", "cheque"],
      default: "cash",
    },
    datePaid: {
      type: Date,
      default: Date.now,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    notes: String,
  },
  { timestamps: true }
);

export default model("Payment", PaymentSchema);
