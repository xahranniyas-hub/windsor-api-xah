import { createHash } from "node:crypto";
import mongoose from "mongoose";
import Booking from "../models/bookingModel.js";
import InvoiceExtraction, { ExtractionSequence } from "../models/invoiceExtractionModel.js";
import { dateRange, makeEntries, MAX_EXTRACTION_SIZE } from "../utils/invoiceExtraction.js";

const fail = (status, message) => Object.assign(new Error(message), { status });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function listExtractions(req, res) {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const batches = await InvoiceExtraction.find().select("-entries -fingerprint")
      .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 25).limit(26).lean();
    res.json({ batches: batches.slice(0, 25), hasMore: batches.length > 25 });
  } catch { res.status(500).json({ message: "Could not load extraction history." }); }
}
export async function getExtraction(req, res) {
  try {
    const batch = await InvoiceExtraction.findById(req.params.id).select("-fingerprint").lean();
    if (!batch) return res.status(404).json({ message: "Extraction not found." });
    res.json(batch);
  } catch { res.status(500).json({ message: "Could not load extraction." }); }
}
export async function createExtraction(req, res) {
  let fingerprint;
  const { requestId, bookingIds, from, to } = req.body;
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > 120) throw fail(400, "Enter a batch name (up to 120 characters).");
    if (typeof requestId !== "string" || !uuidPattern.test(requestId)) throw fail(400, "Invalid extraction request key.");
    if (!Array.isArray(bookingIds) || !bookingIds.length || bookingIds.length > MAX_EXTRACTION_SIZE ||
      bookingIds.some((id) => typeof id !== "string" || !/^[a-f\d]{24}$/i.test(id)) || new Set(bookingIds).size !== bookingIds.length) {
      throw fail(400, `Select between 1 and ${MAX_EXTRACTION_SIZE} distinct invoices.`);
    }
    let range;
    try { range = dateRange(from, to); } catch (error) { throw fail(400, error.message); }
    fingerprint = createHash("sha256").update(JSON.stringify({ name, from, to, ids: [...bookingIds].sort() })).digest("hex");
    const existing = await InvoiceExtraction.findById(requestId).lean();
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw fail(409, "This request key belongs to another selection. Reload and try again.");
      delete existing.fingerprint;
      return res.json(existing);
    }
    // Initialise outside the transaction; _id guarantees exactly one sequence document.
    await Promise.all([InvoiceExtraction.init(), ExtractionSequence.init()]);
    try {
      await ExtractionSequence.updateOne({ _id: "handover" }, { $setOnInsert: { seq: 0 } }, { upsert: true });
    } catch (error) { if (error.code !== 11000) throw error; }
    const batch = await mongoose.connection.transaction(async (session) => {
      const bookings = await Booking.find({
        _id: { $in: bookingIds },
        "finalInvoice.invoiceNumber": { $type: "string", $ne: "" },
        "finalInvoice.dateIssued": range,
      }).session(session).lean();
      if (bookings.length !== bookingIds.length) throw fail(409, "Some invoices were removed or fall outside the invoice-date range. Refresh the selection.");
      if (bookings.some((b) => !Number.isFinite(b.finalInvoice.total))) throw fail(409, "An invoice has an invalid total. Correct it before extracting.");
      const entries = makeEntries(bookings, 1);
      if (Buffer.byteLength(JSON.stringify(entries)) > 10 * 1024 * 1024) throw fail(400, "This batch is too large. Select fewer invoices.");
      const counter = await ExtractionSequence.findByIdAndUpdate("handover", { $inc: { seq: bookings.length } }, { new: true, session });
      const firstNumber = counter.seq - bookings.length + 1;
      const [saved] = await InvoiceExtraction.create([{
        _id: requestId, name, from, to, fingerprint, createdBy: req.user._id,
        firstNumber, lastNumber: counter.seq, count: bookings.length,
        total: bookings.reduce((sum, b) => sum + b.finalInvoice.total, 0),
        entries: makeEntries(bookings, firstNumber),
      }], { session });
      return saved.toObject();
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    delete batch.fingerprint;
    return res.status(201).json(batch);
  } catch (error) {
    // Concurrent retry: the winner committed this same request; its references are reused.
    if (error.code === 11000 && fingerprint) {
      const existing = await InvoiceExtraction.findById(requestId).lean().catch(() => null);
      if (existing?.fingerprint === fingerprint) {
        delete existing.fingerprint;
        return res.json(existing);
      }
    }
    const transactionUnavailable = error.code === 20 || /Transaction numbers are only allowed/.test(error.message);
    res.status(transactionUnavailable ? 503 : error.status || 500).json({ message: transactionUnavailable
      ? "Extraction requires MongoDB Atlas or a replica set so numbering can be saved safely. Ask your administrator to enable transactions."
      : error.status ? error.message : "Extraction could not be completed. Retry the same selection; saved requests will not be duplicated." });
  }
}
