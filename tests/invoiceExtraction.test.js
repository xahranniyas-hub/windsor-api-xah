import test from "node:test";
import assert from "node:assert/strict";
import { dateRange, makeEntries } from "../utils/invoiceExtraction.js";

test("October–March range includes full Sri Lanka days", () => {
  const range = dateRange("2026-10-01", "2027-03-31");
  assert.equal(range.$gte.toISOString(), "2026-09-30T18:30:00.000Z");
  assert.equal(range.$lt.toISOString(), "2027-03-31T18:30:00.000Z");
});
test("invalid calendar dates and reversed ranges are rejected", () => {
  for (const [from, to] of [["2026-02-30", "2026-03-01"], ["2026-11-01", "2026-10-01"], ["", "2026-01-01"]]) assert.throws(() => dateRange(from, to));
});
test("gapped originals receive consecutive references in numeric invoice order", () => {
  const original = [29, 5, 18].map((n) => ({ _id: String(n), finalInvoice: { invoiceNumber: `IN${n}`, total: n }, internalNotes: "not exported" }));
  const entries = makeEntries(original, 11);
  assert.deepEqual(entries.map((entry) => entry.reference), ["EXT000011", "EXT000012", "EXT000013"]);
  assert.deepEqual(entries.map((entry) => entry.booking.finalInvoice.invoiceNumber), ["IN5", "IN18", "IN29"]);
  assert.equal(entries[0].booking.internalNotes, undefined);
  assert.deepEqual(original.map((booking) => booking.finalInvoice.invoiceNumber), ["IN29", "IN5", "IN18"]);
});
