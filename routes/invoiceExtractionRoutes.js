import express from "express";
import { protect, authorizeRole } from "../middleware/authMiddleware.js";
import { createExtraction, getExtraction, listExtractions } from "../controllers/invoiceExtractionController.js";
const router = express.Router();
router.use(protect, authorizeRole(["admin", "editor"]));
router.get("/", listExtractions);
router.post("/", createExtraction);
router.get("/:id", getExtraction);
export default router;
