import mongoose from "mongoose";
const { Schema } = mongoose;
const extractionSchema = new Schema({
  // Client-generated request key: built-in unique _id makes retries idempotent.
  _id: { type: String },
  name: { type: String, required: true },
  referencePrefix: { type: String, enum: ["EXT", "INV"] },
  from: { type: String, required: true },
  to: { type: String, required: true },
  fingerprint: { type: String, required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  firstNumber: { type: Number, required: true },
  lastNumber: { type: Number, required: true },
  count: { type: Number, required: true },
  total: { type: Number, required: true },
  entries: [{
    _id: false,
    bookingId: { type: Schema.Types.ObjectId, required: true },
    reference: { type: String, required: true },
    booking: { type: Schema.Types.Mixed, required: true },
  }],
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });
export const ExtractionSequence = mongoose.model("ExtractionSequence", new Schema({
  _id: String, seq: { type: Number, default: 0 },
}, { versionKey: false }));
export default mongoose.model("InvoiceExtraction", extractionSchema);
