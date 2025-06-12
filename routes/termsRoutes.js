import express from "express";
import { getTerms, updateTerms } from "../controllers/termsController.js";

const router = express.Router();

router.get("/", getTerms);
router.put("/", updateTerms);

export default router;
