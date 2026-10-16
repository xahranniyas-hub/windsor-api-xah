// Run from api. Default is a read-only preview. Never imports the API server.
import "dotenv/config";
import mongoose from "mongoose";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { EXTRACTION_START, EXTRACTION_SEQUENCE_ID } from "../utils/invoiceExtraction.js";

const flags = process.argv.slice(2);
const apply = flags.includes("--reset-all-extractions");
if (flags.some((flag) => flag !== "--reset-all-extractions")) {
  console.error("Usage: node scripts/resetInvoiceExtractions.js [--reset-all-extractions]");
  process.exit(1);
}
if (!process.env.MONGO_URI) {
  console.error("MONGO_URI is missing. Run this from api with your normal .env settings.");
  process.exit(1);
}
try {
  await mongoose.connect(process.env.MONGO_URI, { autoCreate: false, autoIndex: false });
  const db = mongoose.connection;
  const batches = db.collection("invoiceextractions");
  const counters = db.collection("extractionsequences");
  console.log(`Database: ${db.name}`);
  const count = await batches.countDocuments();
  console.log(`Saved extraction batches: ${count}`);
  const recent = await batches.find({}, { projection: { name: 1, firstNumber: 1, lastNumber: 1, referencePrefix: 1 } }).sort({ createdAt: -1 }).limit(10).toArray();
  recent.forEach((batch) => console.log(`${batch.name}: ${batch.referencePrefix || "EXT"}${String(batch.firstNumber).padStart(6, "0")} to ${batch.referencePrefix || "EXT"}${String(batch.lastNumber).padStart(6, "0")}`));
  if (!apply) {
    console.log("PREVIEW ONLY: no data changed.");
    console.log("To clear ALL extraction batches and restart at INV000240, stop the API and run:");
    console.log("node scripts/resetInvoiceExtractions.js --reset-all-extractions");
    console.log("Original invoices, bookings, payments and their counters will not be changed.");
  } else {
    const backupDirectory = resolve("extraction-reset-backups");
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    let backupPath;
    let deletedCount;
    await db.transaction(async (session) => {
      // Lock allocation while collecting a consistent snapshot and clearing batches.
      const previousCounters = await counters.find({ _id: { $in: ["handover", EXTRACTION_SEQUENCE_ID] } }, { session }).toArray();
      await counters.updateOne({ _id: EXTRACTION_SEQUENCE_ID }, { $set: { seq: EXTRACTION_START - 1 } }, { upsert: true, session });
      const savedBatches = await batches.find({}, { session }).toArray();
      backupPath = resolve(backupDirectory, `extractions-${Date.now()}-${randomUUID()}.json`);
      // Backup must succeed before deletion. EJSON preserves MongoDB types.
      const backup = mongoose.mongo.BSON.EJSON.stringify({ database: db.name, backedUpAt: new Date(), batches: savedBatches, counters: previousCounters }, null, 2, { relaxed: false });
      await writeFile(backupPath, backup, { flag: "wx", mode: 0o600 });
      const result = await batches.deleteMany({}, { session });
      deletedCount = result.deletedCount;
      await counters.deleteOne({ _id: "handover" }, { session });
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    console.log(`Cleared ${deletedCount} extraction batches. Next reference: INV000240.`);
    console.log(`Backup: ${backupPath}`);
    console.log("Restart/redeploy the updated API, deploy the updated frontend, and reload the invoices page.");
  }
} catch (error) {
  // Do not print connection strings or credentials contained in driver errors.
  console.error("Reset did not complete. Check database connectivity, transaction support and backup-folder permissions. No partial reset will be committed.");
  if (error.code === 20) console.error("MongoDB Atlas or a replica set is required.");
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
