import express from "express";
import {
  previewOrder,
  createOrder,
  verifyPayment,
  getUserOrders,
  getOrderById,
  trackOrder,
  downloadInvoice,
  applyCoupon,
} from "../controllers/orderController.js";
import { verifyToken } from "../middleware/auth.js";

const router = express.Router();

router.post("/preview", verifyToken, previewOrder);
router.post("/create", verifyToken, createOrder);
router.post("/verify", verifyToken, verifyPayment);
router.get("/my-orders", verifyToken, getUserOrders);
router.get("/my-orders/:orderId", verifyToken, getOrderById);
router.get("/:orderId/tracking", verifyToken, trackOrder);
router.get("/invoice/:orderId", verifyToken, downloadInvoice);
router.post("/apply-coupon", verifyToken, applyCoupon);

export default router;
