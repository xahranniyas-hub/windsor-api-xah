import Terms from "../models/termsModel.js";

// GET terms
export const getTerms = async (req, res) => {
  try {
    const termsDoc = await Terms.findById("default");
    res.status(200).json(termsDoc);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// UPDATE terms
export const updateTerms = async (req, res) => {
  try {
    const { terms } = req.body;
    await Terms.findByIdAndUpdate("default", { terms }, { new: true });
    res.status(200).json({ message: "Terms updated successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
