import mongoose from "mongoose";

const termsSchema = new mongoose.Schema({
  _id: { type: String, default: "default" },
  terms: [String],
});

export default mongoose.model("Terms", termsSchema);
