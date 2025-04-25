// models/userModel.js
import mongoose from "mongoose";

const { Schema, model } = mongoose;

const UserSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true, // Store only hashed passwords
    },
    role: {
      type: String,
      enum: ["viewer", "editor", "admin"],
      default: "viewer",
    },
    email: {
      type: String,
    },
  },
  { timestamps: true }
);

export default model("User", UserSchema);
