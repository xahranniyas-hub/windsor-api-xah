import mongoose from "mongoose";
const { Schema, model } = mongoose;

const BallroomSubSchema = new Schema(
  {
    name: { type: String, enum: ["Grand", "Diamond", "Royal"], required: true },
    guests: { type: Number, min: 1, required: true },
  },
  { _id: false } // we don’t need a sub-document id
);

const PencilBookingSchema = new Schema(
  {
    serialNumber: { type: String, unique: true },

    date: { type: Date, required: true },
    timeSlot: { type: String, enum: ["Lunch", "Dinner"], required: true },

    /** ⇣  MULTIPLE BALLROOMS  ⇣ **/
    ballrooms: { type: [BallroomSubSchema], required: true },

    customerInfo: {
      name: { type: String, required: true },
      phone: { type: String, required: true },
      email: { type: String },
      NIC: { type: String, required: true },
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

export default model("PencilBooking", PencilBookingSchema);
