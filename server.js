import express from "express";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import cors from "cors";
import job from "./config/cron.js";

// Import routes
import authRoutes from "./routes/authRoutes.js";
import pencilBookingRoutes from "./routes/pencilBookingRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import memoRoutes from "./routes/memoRoutes.js";
import termsRoutes from "./routes/termsRoutes.js";
import quotationRoutes from "./routes/quotationRoutes.js";

import invoiceExtractionRoutes from "./routes/invoiceExtractionRoutes.js";

const app = express();
dotenv.config();

const port = process.env.PORT;

job.start();
app.use(cors());

// Connect to MongoDB
connectDB();

// Global middlewares
app.use(express.json());

// Base test
app.get("/", (req, res) => res.send("Hello World!"));

// Mount routes
app.use("/api/invoice-extractions", invoiceExtractionRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/pencil-bookings", pencilBookingRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/memos", memoRoutes);
app.use("/api/terms", termsRoutes);
app.use("/api/quotations", quotationRoutes);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}!`);
});
