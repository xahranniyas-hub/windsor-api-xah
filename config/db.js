import mongoose from "mongoose";

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected successfully");
  } catch (err) {
    console.error("MongoDB connection error: ", err);
    process.exit(1); // Stop the process if we can't connect
  }
};

export default connectDB;
