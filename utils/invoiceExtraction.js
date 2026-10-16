// Pure helpers shared by the extraction controller and its tests.
export const MAX_EXTRACTION_SIZE = 300;
export const EXTRACTION_START = 240;
export const EXTRACTION_SEQUENCE_ID = "handover-inv";
export function dateRange(from, to) {
  const parse = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Choose valid From and To dates.");
    const day = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value) throw new Error("Invalid calendar date.");
    return day.getTime();
  };
  const start = parse(from), end = parse(to);
  if (start > end) throw new Error("From date must be before To date.");
  // Invoice date filters consistently use Sri Lanka time, including the entire To day.
  return { $gte: new Date(start - 19800000), $lt: new Date(end + 86400000 - 19800000) };
}
export function sortInvoices(bookings) {
  return [...bookings].sort((a, b) =>
    a.finalInvoice.invoiceNumber.localeCompare(b.finalInvoice.invoiceNumber, "en", { numeric: true }) ||
    String(a._id).localeCompare(String(b._id)));
}
export function makeEntries(bookings, firstNumber) {
  const fields = ["_id", "serialNumber", "customerInfo", "ballrooms", "ballroom", "guestsCount", "date", "foodMenu", "foodMenuCost", "indicativePricing", "additionalCosts", "advancePayments", "refundableDepositPayments", "refundableDepositDue", "balanceDue", "invoiceOverpaid", "finalInvoice", "status"];
  return sortInvoices(bookings).map((booking, index) => ({
    bookingId: booking._id,
    reference: `INV${String(firstNumber + index).padStart(6, "0")}`,
    booking: Object.fromEntries(fields.filter((key) => booking[key] !== undefined).map((key) => [key, booking[key]])),
  }));
}
