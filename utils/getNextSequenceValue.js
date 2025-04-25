// utils/getNextSequenceValue.js
import Counter from "../models/counterModel.js";

export async function getNextSequenceValue(name) {
  // Find the counter doc by name, increment seq by 1, return the updated doc
  const updatedCounter = await Counter.findOneAndUpdate(
    { name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true } // create if it doesn't exist
  );
  return updatedCounter.seq; // the new seq value
}
