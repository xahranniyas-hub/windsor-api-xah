// controllers/bookingController.js
import Booking from "../models/bookingModel.js";
import { getNextSequenceValue } from "../utils/getNextSequenceValue.js";

/* ─────────────────────────────────────────  Helpers ── */
const calcTotalAdvance = (adv = []) =>
  adv.reduce((sum, p) => sum + Number(p.amount || 0), 0);

const calcSum = (arr = []) =>
  arr.reduce((s, p) => s + Number(p.amount || 0), 0);

const calcDepositCollected = (rows = []) =>
  rows.reduce((s, p) => s + (p.amount > 0 ? Number(p.amount) : 0), 0);

/**
 * (re)computes: balanceDue ‖ refundDueToCustomer ‖ finalInvoice.status
 * call this after you push / splice any payment rows.
 */
function recomputeFinancials(booking) {
  /* 1. invoice balance & over-payments (ONLY if an invoice exists) */
  const hasInvoice = !!booking.finalInvoice;
  const invoiceTotal = hasInvoice ? booking.finalInvoice.total : 0;
  const paymentsTotal = calcSum(booking.advancePayments);

  if (hasInvoice) {
    if (paymentsTotal >= invoiceTotal) {
      booking.balanceDue = 0;
      booking.invoiceOverpaid = paymentsTotal - invoiceTotal;
    } else {
      booking.balanceDue = invoiceTotal - paymentsTotal;
      booking.invoiceOverpaid = 0;
    }
  } else {
    booking.balanceDue = 0;
    booking.invoiceOverpaid = 0; // <── the key change
  }

  /* ——— 2. break the deposit ledger into parts ——— */
  const pos = booking.refundableDepositPayments // all cash collected
    .filter((p) => p.amount > 0)
    .reduce((s, p) => s + p.amount, 0);

  const negDeposit = booking.refundableDepositPayments // applied to invoice
    .filter((p) => p.amount < 0 && p.mode === "deposit")
    .reduce((s, p) => s + Math.abs(p.amount), 0);

  const negRefund = booking.refundableDepositPayments // paid back to customer
    .filter((p) => p.amount < 0 && p.mode !== "deposit")
    .reduce((s, p) => s + Math.abs(p.amount), 0);

  const depositCollected = Math.max(0, pos - negDeposit - negRefund); // in hand
  const depositUsed = negDeposit; // applied

  /* ——— 3. what is still to be collected ——— */
  const due = booking.refundableDepositDue || 0;
  booking.refundableDepositOutstanding = Math.max(0, due - pos);

  /* 4. how much we still owe the customer */
  const canRefundDeposit = hasInvoice && booking.balanceDue === 0;

  booking.refundDueToCustomer =
    (hasInvoice ? booking.invoiceOverpaid : 0) +
    (canRefundDeposit ? depositCollected : 0);

  /* ——— 5. expose helper numbers to the client ——— */
  booking.depositCollected = depositCollected;
  booking.depositUsed = depositUsed;

  /* ——— 6. update invoice status ——— */
  if (booking.finalInvoice) {
    booking.finalInvoice.status = booking.balanceDue === 0 ? "Settled" : "Open";
  }
}

/* ─────────────────────────────────────────  READS ── */
export const getAllBookings = async (req, res) => {
  try {
    const { status, search } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (search)
      filter["customerInfo.phone"] = { $regex: search, $options: "i" };

    const bookings = await Booking.find(filter).sort({ createdAt: -1 });
    return res.json(bookings);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const getBookingById = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    return res.json(booking);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────  PAYMENTS ── */
export const addAdvancePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, reference, description, mode, amount } = req.body;

    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    /* ----- 1. How much deposit is still un-collected? ----- */
    const outstanding = booking.refundableDepositOutstanding || 0;
    let toDeposit = Math.min(outstanding, amount); // allocate as much as needed
    let toInvoice = amount - toDeposit;

    /* ----- 2. Serial numbers ----- */
    const seq = await getNextSequenceValue("advancePayments"); // one seq for both rows

    /* ----- 3. PUSH deposit row first (if any) ----- */
    if (toDeposit > 0) {
      booking.refundableDepositPayments.push({
        date,
        serialNumber: `DP${String(seq).padStart(6, "0")}`,
        reference,
        description: description || "Deposit collected",
        mode,
        amount: toDeposit, // positive!
      });
    }

    /* ----- 4. PUSH invoice/advance row (if any) ----- */
    if (toInvoice > 0) {
      booking.advancePayments.push({
        date,
        serialNumber: `AP${String(seq).padStart(6, "0")}`,
        reference,
        description,
        mode,
        amount: toInvoice,
      });
    }

    /* ----- 5. Recompute aggregates ----- */
    recomputeFinancials(booking);

    await booking.save();

    return res.json(booking);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

//Receive payment
export const receivePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { depositApplied = 0, payment = null, target = "invoice" } = req.body;

    const booking = await Booking.findById(id);
    if (!booking) throw new Error("Booking not found");

    /* guard: cannot apply deposit that hasn’t been collected yet */
    const pool = calcDepositCollected(booking.refundableDepositPayments);
    if (depositApplied > pool)
      throw new Error(
        `Cannot apply Rs ${depositApplied.toFixed(2)}; only Rs ${pool.toFixed(
          2
        )} of the deposit has been collected.`
      );

    /* ───  A.  move deposit → a PY row  ─────────────────────── */
    if (depositApplied > 0) {
      const seq = await getNextSequenceValue("advancePayments");

      /* positive payment entry (will appear in the invoice’s payment list) */
      booking.advancePayments.push({
        date: new Date(),
        serialNumber: `PY${String(seq).padStart(6, "0")}`,
        reference: "deposit-used",
        description: "Refundable deposit applied against invoice",
        mode: "deposit", // ← NEW enum value already added
        amount: depositApplied,
      });

      /* matching *negative* row to reduce the pool that is still refundable */
      booking.refundableDepositPayments.push({
        date: new Date(),
        serialNumber: `DP${String(seq).padStart(6, "0")}`,
        reference: "deposit-used",
        description: "Deposit applied to invoice",
        mode: "deposit",
        amount: -depositApplied,
      });
    }

    /* ───  B.  ordinary extra payment (still optional) ──────── */
    if (payment && payment.amount > 0) {
      const seq = await getNextSequenceValue("advancePayments");
      booking.advancePayments.push({
        date: payment.date,
        serialNumber: `PY${String(seq).padStart(6, "0")}`,
        reference: payment.reference,
        description: payment.description || "Invoice payment",
        mode: payment.mode,
        amount: payment.amount,
      });
    }

    /* ───  C.  recompute financials  ────────────────────────── */
    recomputeFinancials(booking);

    await booking.save();
    return res.json(booking);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────  UPDATE ── */
export const updateBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    /* ─── 1. straight-forward field updates ─────────────────────────── */
    if (req.body.customerInfo) booking.customerInfo = req.body.customerInfo;
    if (req.body.date) booking.date = req.body.date;
    if (req.body.timeSlot) booking.timeSlot = req.body.timeSlot;
    if (req.body.ballrooms) booking.ballrooms = req.body.ballrooms; // array
    if (req.body.foodMenu) booking.foodMenu = req.body.foodMenu;
    if (req.body.foodMenuCost) booking.foodMenuCost = req.body.foodMenuCost;
    /* ── menu description (allow blank to clear) ───────────────────── */
    if (Object.prototype.hasOwnProperty.call(req.body, "menuDescription")) {
      booking.menuDescription = req.body.menuDescription ?? "";
    }

    if (req.body.indicativePricing !== undefined) {
      booking.indicativePricing = req.body.indicativePricing;
    }

    if (req.body.discount !== undefined) {
      booking.discount = req.body.discount;
      booking.approvedDiscount = false; // reset approval
    }

    /* ── custom time validation & update ───────────────────────────── */
    if (req.body.customTime) {
      const { start, end } = req.body.customTime;
      const HHMM = /^([0-1]?\d|2[0-3]):[0-5]\d$/;
      if (!HHMM.test(start) || !HHMM.test(end)) {
        return res
          .status(400)
          .json({ message: "customTime must be in HH:mm 24-hour format." });
      }
      const diffMinutes = (a, b) => {
        const [sH, sM] = a.split(":").map(Number);
        const [eH, eM] = b.split(":").map(Number);
        let d = eH * 60 + eM - (sH * 60 + sM);
        if (d <= 0) d += 24 * 60;
        return d;
      };
      if (diffMinutes(start, end) === 0) {
        return res
          .status(400)
          .json({ message: "Start and end time cannot be the same." });
      }
      booking.customTime = { start, end }; // overwrite whole sub-doc
    }

    /* ─── 2. additionalCosts – merge, don’t overwrite ───────────────── */
    if (Array.isArray(req.body.additionalCosts)) {
      /* A.  rows coming from the *booking* editor → always editable:false */
      const bookingTimeRows = req.body.additionalCosts.map((r) => {
        const cost = Number(r.cost) || 0;
        const quantity = Number(r.quantity) || 0;
        const amount =
          r.amount !== undefined ? Number(r.amount) : cost * quantity;

        return {
          type: r.type || "",
          description: r.description || "",
          cost,
          quantity,
          amount,
          editable: false, // ← lock these for invoice editor
        };
      });

      /* B.  keep any invoice-time rows that are already stored */
      const invoiceRows = (booking.additionalCosts || []).filter(
        (r) => r.editable
      );

      /* C.  replace array with merged result */
      booking.additionalCosts = [...invoiceRows, ...bookingTimeRows];
    }

    /* ─── 3. re-compute derived balances ────────────────────────────── */
    recomputeFinancials(booking);

    await booking.save();
    return res.json(booking);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/* ------------------------------------------------------------------ */
/*  FINAL INVOICE – create / update                                   */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/*  FINAL INVOICE – create / update                                   */
/* ------------------------------------------------------------------ */
export const generateFinalInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    let { invoiceNumber, additionalCosts = [] } = req.body;

    /* ---------- fetch booking ---------- */
    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    /* ---------- invoice # if missing ---------- */
    if (!invoiceNumber) {
      const seq = await getNextSequenceValue("invoices");
      invoiceNumber = `IN${seq.toString().padStart(6, "0")}`;
    }

    /* ---------- normalise NEW rows ---------- */
    additionalCosts = additionalCosts.map((row) => {
      const cost = Number(row.cost) || 0;
      const quantity = Number(row.quantity) || 0;
      return {
        type: row.type || "",
        description: row.description || "",
        cost,
        quantity,
        amount: row.amount !== undefined ? Number(row.amount) : cost * quantity,
        editable: true,
      };
    });

    // drop any rows that end up with amount === 0
    additionalCosts = additionalCosts.filter((r) => r.amount !== 0);

    /* ---------- merge NEW rows with EXISTING ones ---------- */
    // in generateFinalInvoice before pushing new rows
    booking.additionalCosts = booking.additionalCosts.filter(
      (r) => !r.editable
    );
    booking.additionalCosts.push(...additionalCosts);

    /* ---------- totals ---------- */
    const totalExtra = booking.additionalCosts.reduce(
      (s, r) => s + r.amount,
      0
    );
    const subtotal = Number(booking.indicativePricing) + totalExtra;
    const vat = 0; // add VAT here if needed
    const total = subtotal + vat;

    /* ---------- write / update invoice ---------- */
    booking.finalInvoice = {
      invoiceNumber,
      dateIssued: new Date(),
      lineItems: booking.additionalCosts, // <─ take the unified list
      subtotal,
      vat,
      total,
    };

    booking.status = "completed";
    recomputeFinancials(booking);

    await booking.save();
    return res.json({ message: "Final invoice updated", booking });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────  STATUS CHANGES ── */
export const closeBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { isFullySettled } = req.body;

    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    booking.status = isFullySettled ? "completed" : "partially_closed";
    await booking.save();

    return res.json({
      message: "Booking status updated",
      status: booking.status,
    });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

export const deleteBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    await booking.deleteOne();
    return res.json({ message: "Booking deleted successfully" });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

// Refund back to customer
export const refundDeposit = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, reference, description, mode, amount } = req.body;

    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    /* ---------- validations ---------- */
    const refundDue = booking.refundDueToCustomer ?? 0;
    if (amount <= 0) throw new Error("Amount must be greater than zero");
    if (amount > refundDue)
      throw new Error(
        `Refund exceeds deposit remaining (max ${refundDue.toFixed(2)})`
      );

    /* ---------- allocate refund ---------- */
    let remaining = amount;

    /* A.  First drain any invoice over-payment -------------------------- */
    if (booking.invoiceOverpaid > 0) {
      const used = Math.min(remaining, booking.invoiceOverpaid);
      booking.invoiceOverpaid -= used;
      remaining -= used;

      const seqAP = await getNextSequenceValue("refundDeposits");
      booking.advancePayments.push({
        date: date ? new Date(date) : new Date(),
        serialNumber: `RF${String(seqAP).padStart(6, "0")}`,
        reference,
        description: description || "Refund – invoice over-payment",
        mode,
        amount: -used, // negative cash out
      });
    }

    /* B.  Then, if anything left, refund deposit as before --------------- */
    if (remaining > 0) {
      const seqDP = await getNextSequenceValue("refundDeposits");
      booking.refundableDepositPayments.push({
        date: date ? new Date(date) : new Date(),
        serialNumber: `RF${String(seqDP).padStart(6, "0")}`,
        reference,
        description: description || "Refund – refundable deposit",
        mode,
        amount: -remaining,
      });
    }

    /* ---------- recompute balances ---------- */
    recomputeFinancials(booking);

    await booking.save();
    return res.json(booking);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/* DELETE-PAYMENT (called from payments table actions) */
export const deletePayment = async (req, res) => {
  try {
    const { id, serial } = req.params;

    /* ---------- fetch booking ---------- */
    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    /* ---------- helpers ---------- */
    const seqOf = (sn) => sn.slice(2); // 'DP000123' → '000123'

    const removeRow = (arr, sn) => {
      const before = arr.length;
      arr = arr.filter((p) => p.serialNumber !== sn);
      return { removed: before !== arr.length, arr };
    };

    /* ---------- step 1: locate the row ---------- */
    const inAdv = booking.advancePayments.find(
      (p) => p.serialNumber === serial
    );
    const inDep = booking.refundableDepositPayments.find(
      (p) => p.serialNumber === serial
    );

    if (!inAdv && !inDep)
      return res.status(404).json({ message: "Payment not found" });

    /* ---------- step 2: delete the requested row (and twin if needed) ---------- */
    const deletePairIfNeeded = () => {
      /* —— A. deletion inside advancePayments —— */
      if (inAdv) {
        const { arr } = removeRow(booking.advancePayments, serial);
        booking.advancePayments = arr;

        if (inAdv.mode === "deposit") {
          // it is the PY side of a pair – delete matching DP…
          const twin = `DP${seqOf(serial)}`;
          booking.refundableDepositPayments =
            booking.refundableDepositPayments.filter(
              (p) => p.serialNumber !== twin
            );
        }
      }

      /* —— B. deletion inside refundableDepositPayments —— */
      if (inDep) {
        const { arr } = removeRow(booking.refundableDepositPayments, serial);
        booking.refundableDepositPayments = arr;

        if (inDep.mode === "deposit" && inDep.amount < 0) {
          // negative DP… row → its twin is the PY side
          const twin = `PY${seqOf(serial)}`;
          booking.advancePayments = booking.advancePayments.filter(
            (p) => p.serialNumber !== twin
          );
        }
      }
    };

    deletePairIfNeeded();

    /* ---------- step 3: validate pool won’t turn negative ---------- */
    const depositSum = booking.refundableDepositPayments.reduce(
      (s, p) => s + Number(p.amount || 0),
      0
    );

    if (depositSum < 0) {
      return res.status(400).json({
        message:
          "Cannot delete: refundable-deposit pool would become negative.",
      });
    }

    /* ---------- step 4: recompute aggregates ---------- */
    recomputeFinancials(booking);
    await booking.save();

    return res.json({ message: "Payment deleted", booking });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

// Edit Payment PATCH /api/bookings/:id/payments/:serial
// controllers/bookingController.js
export const updatePayment = async (req, res) => {
  try {
    const { id, serial } = req.params;
    const { date, reference, description, mode, amount } = req.body;

    /* ───── fetch booking ───── */
    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    /* ───── helpers ───── */
    const seqOf = (sn) => sn.slice(2); // 'DP000123' → '000123'
    const findRow = (arr) => arr.find((p) => p.serialNumber === serial);

    /* original row (before edit) */
    const orig =
      findRow(booking.advancePayments) ||
      findRow(booking.refundableDepositPayments);

    if (!orig) return res.status(404).json({ message: "Payment not found" });

    /* ── 1. Row-level validation ────────────────────────────── */
    if (
      orig.mode === "deposit" &&
      orig.serialNumber.startsWith("DP") && // deposit-collected row
      orig.amount > 0 // positive = collected
    ) {
      const proposed = amount !== undefined ? Number(amount) : orig.amount;
      if (proposed > orig.amount) {
        return res.status(400).json({
          message: `Deposit cannot be increased beyond original amount (${orig.amount.toFixed(
            2
          )}). You may only reduce or keep it the same.`,
        });
      }
    }

    /* ── 2. Mutate the edited row ───────────────────────────── */
    const apply = (row) => {
      if (date) row.date = new Date(date);
      if (reference) row.reference = reference;
      if (description) row.description = description;
      if (mode) row.mode = mode;
      if (amount !== undefined) row.amount = Number(amount);
    };

    const patchRow = (arr, sn, mutator) => {
      const idx = arr.findIndex((p) => p.serialNumber === sn);
      if (idx !== -1) mutator(arr[idx]);
      return idx !== -1;
    };

    const editedInAdv = patchRow(booking.advancePayments, serial, apply);
    const editedInDep =
      !editedInAdv &&
      patchRow(booking.refundableDepositPayments, serial, apply);

    /* ── 3. Keep the deposit pair (PY / DP) in sync ─────────── */
    const syncPair = () => {
      /* edited a PY… (deposit applied) ─> sync DP… */
      if (editedInAdv) {
        const py = findRow(booking.advancePayments);
        if (py?.mode === "deposit") {
          const twin = `DP${seqOf(serial)}`; // same seq, different prefix
          patchRow(booking.refundableDepositPayments, twin, (dp) => {
            dp.amount = -Math.abs(py.amount);
            dp.date = py.date;
            dp.reference = py.reference;
            dp.description = py.description;
          });
        }
      }

      /* edited a DP… (deposit ledger) ─> sync PY… */
      if (editedInDep) {
        const dp = findRow(booking.refundableDepositPayments);
        if (dp?.mode === "deposit") {
          const twin = `PY${seqOf(serial)}`;
          patchRow(booking.advancePayments, twin, (py) => {
            py.amount = Math.abs(dp.amount); // positive
            py.date = dp.date;
            py.reference = dp.reference;
            py.description = dp.description;
          });
        }
      }
    };

    syncPair();

    /* ── 4. Global pool validation ──────────────────────────── */
    const depositSum = calcSum(booking.refundableDepositPayments); // helper already in this file
    if (depositSum < 0) {
      return res.status(400).json({
        message:
          "Change rejected: resulting refundable-deposit balance would be negative.",
      });
    }

    /* ── 5. Re-compute aggregates & save ────────────────────── */
    recomputeFinancials(booking);
    await booking.save();

    return res.json({ message: "Payment updated", booking });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

import nodemailer from "nodemailer";
import path from "path";
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";

// Helper to locate your frontend’s “printable” URL. For example, if your React app
// has a route at /print-booking/:id that renders <BookingPrint>, point Puppeteer at it.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ideally, your React app is hosted at SOME_BASE_URL. In development, that might be http://localhost:3000
// In production, set this to your deployed front-end domain.
const FRONTEND_BASE_URL =
  process.env.FRONTEND_BASE_URL || "http://localhost:5173";

export const emailBookingPdf = async (req, res) => {
  const bookingId = req.params.id;

  try {
    // 1. Fetch booking
    const booking = await Booking.findById(bookingId).lean();
    if (!booking) {
      return res.status(404).json({ message: "Booking not found." });
    }

    // 2. Ensure customer email exists
    const customerEmail = booking.customerInfo?.email;
    if (!customerEmail) {
      return res
        .status(400)
        .json({ message: "Customer has no email on file." });
    }

    /** 3. Launch Puppeteer and generate PDF **/

    // a) Launch headless Chrome
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();

    // b) Build the URL that renders your React <BookingPrint> for this booking.
    //    Somewhere in your React app you might have a route like /print-booking/:id
    //    that simply renders <BookingPrint bookingId={id} /> and fetches its data.
    //
    //    If you don’t have such a route, you can create one in your front end that:
    //    - Reads the booking ID from the URL param
    //    - Fetches booking data from your API (/api/bookings/:id)
    //    - Renders <BookingPrint booking={...} />
    //
    //    For example: <Route path="/print-booking/:id" element={<BookingPrintPage />} />
    const printableUrl = `${FRONTEND_BASE_URL}/print-booking/${bookingId}`;

    // c) Navigate there and wait until network is idle
    await page.goto(printableUrl, { waitUntil: "networkidle0" });

    // d) Generate the PDF buffer
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "1cm", bottom: "1cm", left: "1cm", right: "1cm" },
    });

    await browser.close();

    /** 4. Send email via Nodemailer **/

    // a) Create a transporter (e.g., using SMTP). You must set these env vars in .env:
    //    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // b) Prepare email options
    const mailOptions = {
      from: `"Windsor Castle Banquet" <${process.env.SMTP_FROM_ADDRESS}>`,
      to: customerEmail,
      subject: `Windsor Castle Booking Memo`,
      text: `Dear ${booking.customerInfo.name},\n\nPlease find attached the memo for your booking ${booking.serialNumber}.\n\nThank you for choosing us!\n\n--\nWindsor Castle Banquet (Pvt) Ltd\nNo. 292, Attidiya Road, Dehiwala\n\nEmail: windsorcastlebanquet@gmail.com\nPhone: +94 112 721 421 | +94 74 315 8784`,
      attachments: [
        {
          filename: `Booking_${booking.serialNumber || bookingId}.pdf`,
          content: pdfBuffer,
        },
      ],
    };

    // c) Send mail
    const info = await transporter.sendMail(mailOptions);

    return res
      .status(200)
      .json({ message: "Email sent", messageId: info.messageId });
  } catch (err) {
    console.error("Error in emailBookingPdf:", err);
    return res
      .status(500)
      .json({ message: "Server error sending email.", error: err.message });
  }
};
