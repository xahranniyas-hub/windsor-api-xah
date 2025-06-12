import mongoose from "mongoose";
import dotenv from "dotenv";
import Terms from "./models/termsModel.js";

dotenv.config();

const initialTerms = [
  "Ballroom use is for the allocated time duration. Extra hours are Rs. 100,000.00 each, subject to availability and management approval",
  "Breakages will be assessed and charged according to the Company Policy",
  "Open fire & candle lighting are strictly not allowed at the property",
  "Leftover food is not permitted to be taken off the premises",
  "Pork is not served on the premises",
  "LKR {advancePaid} of cash advance is to be paid at confirmation, and LKR {depositDue} as refundable deposit will be collected to cover any breakages, damages, and additional charges",
  "A maximum of 15 additional guests beyond the agreed count is permitted",
  "Balance full payment to be made no later than two weeks prior to the event. In case of cancellation, the advance payment will not be refunded",
];

mongoose.connect(process.env.MONGO_URI).then(async () => {
  await Terms.create({ _id: "default", terms: initialTerms });
  console.log("Initial terms seeded!");
  mongoose.connection.close();
});
