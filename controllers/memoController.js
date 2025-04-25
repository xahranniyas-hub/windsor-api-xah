// controllers/memoController.js
import Memo from "../models/memoModel.js";
import Booking from "../models/bookingModel.js";

export const createMemo = async (req, res) => {
  try {
    const { bookingId, amountPaid, memoNumber, paymentMethod, notes } =
      req.body;

    // Check the booking exists
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Create the memo
    const memo = await Memo.create({
      bookingId,
      memoNumber,
      dateIssued: new Date(),
      amountPaid,
      paymentMethod,
      notes,
    });

    return res.status(201).json(memo);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

export const getMemosForBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const memos = await Memo.find({ bookingId });
    return res.json(memos);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
