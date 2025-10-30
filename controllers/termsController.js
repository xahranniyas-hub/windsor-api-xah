// controllers/termsController.js
import Terms from "../models/termsModel.js";

// GET terms (create empty doc if missing)
export const getTerms = async (req, res) => {
  try {
    let termsDoc = await Terms.findById("default");
    if (!termsDoc) {
      termsDoc = await Terms.create({ _id: "default", terms: [] });
    }
    res.status(200).json(termsDoc);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// UPDATE terms (trim, dedupe, upsert)
export const updateTerms = async (req, res) => {
  try {
    let { terms } = req.body;
    if (!Array.isArray(terms)) {
      return res
        .status(400)
        .json({ error: "terms must be an array of strings" });
    }

    terms = terms.map((t) => String(t).trim()).filter(Boolean);
    terms = [...new Set(terms)]; // dedupe

    const doc = await Terms.findByIdAndUpdate(
      "default",
      { _id: "default", terms },
      { new: true, upsert: true, runValidators: true }
    );

    res
      .status(200)
      .json({ message: "Terms updated successfully", terms: doc.terms });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
