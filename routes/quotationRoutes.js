// routes/quotationRoutes.js
import express from "express";
import {
  createQuotation,
  getAllQuotations,
  getQuotationById,
  updateQuotation,
  deleteQuotation,
} from "../controllers/quotationController.js";

const router = express.Router();

// POST   /api/quotations         → createQuotation
// GET    /api/quotations         → getAllQuotations
// GET    /api/quotations/:id     → getQuotationById
// PUT    /api/quotations/:id     → updateQuotation
// DELETE /api/quotations/:id     → deleteQuotation

router.post("/", createQuotation);
router.get("/", getAllQuotations);
router.get("/:id", getQuotationById);
router.put("/:id", updateQuotation);
router.delete("/:id", deleteQuotation);

export default router;
