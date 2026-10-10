// Run only against a disposable local replica set. No application .env is loaded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import routes from "../routes/invoiceExtractionRoutes.js";
import Booking from "../models/bookingModel.js";
import User from "../models/userModel.js";
import Batch, { ExtractionSequence } from "../models/invoiceExtractionModel.js";

test("extraction API: authorization, snapshots, retries, concurrency and rollback", { skip: !process.env.TEST_MONGODB_URI }, async () => {
  assert.match(process.env.TEST_MONGODB_URI, /^mongodb:\/\/(127\.0\.0\.1|localhost):/);
  await mongoose.connect(process.env.TEST_MONGODB_URI, { dbName: `extraction_test_${Date.now()}` });
  process.env.JWT_SECRET = "local-test-only-secret";
  const app = express(); app.use(express.json()); app.use("/api/invoice-extractions", routes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/invoice-extractions`;
  const adminId = new mongoose.Types.ObjectId(), viewerId = new mongoose.Types.ObjectId();
  const token = jwt.sign({ id: String(adminId) }, process.env.JWT_SECRET);
  const call = async (method, path = "", body, auth = token) => {
    const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    return { status: response.status, body: response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : text };
  };
  try {
    await User.collection.insertMany([{ _id: adminId, username: "testadmin", role: "admin" }, { _id: viewerId, username: "testviewer", role: "viewer" }]);
    const bookings = [510, 518, 529].map((number) => ({ _id: new mongoose.Types.ObjectId(), customerInfo: { name: `Customer ${number}` }, finalInvoice: { invoiceNumber: `IN${number}`, dateIssued: new Date("2026-10-01T00:00:00Z"), total: number }, internalNotes: "private" }));
    await Booking.collection.insertMany(bookings);
    const payload = (ids = bookings.map((b) => String(b._id))) => ({ name: "Oct–Mar", from: "2026-10-01", to: "2027-03-31", bookingIds: ids, requestId: randomUUID() });
    assert.equal((await call("GET", "", null, null)).status, 401);
    assert.equal((await call("GET", "", null, jwt.sign({ id: String(viewerId) }, process.env.JWT_SECRET))).status, 403);
    const request = payload();
    const first = await call("POST", "", request);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.deepEqual(first.body.entries.map((e) => e.reference), ["EXT000001", "EXT000002", "EXT000003"]);
    assert.equal(first.body.entries[0].booking.internalNotes, undefined);
    assert.equal((await call("POST", "", request)).body._id, first.body._id);
    assert.equal((await call("POST", "", { ...request, name: "changed" })).status, 409);
    await Booking.collection.updateOne({ _id: bookings[0]._id }, { $set: { "finalInvoice.total": 9999 } });
    assert.equal((await call("GET", `/${request.requestId}`)).body.entries[0].booking.finalInvoice.total, 510);
    const before = (await ExtractionSequence.findById("handover")).seq;
    assert.equal((await call("POST", "", payload([String(new mongoose.Types.ObjectId())]))).status, 409);
    assert.equal((await call("POST", "", { ...payload(), from: "2027-01-01" })).status, 409);
    assert.equal((await ExtractionSequence.findById("handover")).seq, before);
    const retry = payload([String(bookings[1]._id)]);
    const same = await Promise.all([call("POST", "", retry), call("POST", "", retry)]);
    assert.ok(same.every((result) => [200, 201].includes(result.status)), JSON.stringify(same));
    assert.equal(same[0].body.entries[0].reference, same[1].body.entries[0].reference);
    const parallel = await Promise.all([call("POST", "", payload([String(bookings[1]._id)])), call("POST", "", payload([String(bookings[2]._id)]))]);
    assert.ok(parallel.every((result) => result.status === 201), JSON.stringify(parallel));
    assert.deepEqual(parallel.map((result) => result.body.firstNumber).sort(), [5, 6]);
    // Force a failure after counter allocation to verify transaction rollback.
    const originalCreate = Batch.create;
    Batch.create = async () => { throw new Error("Injected save failure"); };
    try { assert.equal((await call("POST", "", payload())).status, 500); }
    finally { Batch.create = originalCreate; }
    assert.equal((await ExtractionSequence.findById("handover")).seq, 6);
    assert.equal(await Batch.countDocuments(), 4);
    const listing = await call("GET");
    assert.equal(listing.body.batches.length, 4);
    assert.equal(listing.body.batches[0].entries, undefined);
    assert.equal((await call("DELETE", `/${request.requestId}`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
