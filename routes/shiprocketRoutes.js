import express from "express";

import {
  testShiprocket,
  getServiceability,
} from "../controllers/shiprocketController.js";

import { verifyToken, isAdmin } from "../middleware/auth.js";

const router = express.Router();

router.get("/test", verifyToken, isAdmin, testShiprocket);

router.post("/serviceability", verifyToken, getServiceability);

export default router;
