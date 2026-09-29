import express from "express";
import { getActiveCoupons } from "../controllers/couponController.js";

const router = express.Router();

router.get("/active", getActiveCoupons);

export default router;