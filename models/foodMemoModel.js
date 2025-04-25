// models/foodMemoModel.js
import mongoose from "mongoose";

const { Schema, model } = mongoose;

const FoodMemoSchema = new Schema(
  {
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },
    items: [
      {
        name: String,
        quantity: Number,
        pricePerUnit: Number,
      },
    ],
    total: Number,
  },
  { timestamps: true }
);

export default model("FoodMemo", FoodMemoSchema);
