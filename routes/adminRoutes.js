import express from "express";
import {
  addProduct,
  editProduct,
  deleteProduct,
  getProductReviewsAdmin,
  deleteReview,
  getAdminOrders,
  getAdminOrderById,
  updateOrderStatus,
  getAdminUsers,
  toggleBlockUser,
  getAdminReports,
  forgotAdminPassword,
  resetAdminPassword,
  createCoupon,
  getAdminCoupons,
  toggleCouponStatus,
  deleteCoupon,
} from "../controllers/adminController.js";
import { adminResetLimiter } from "../middleware/authRateLimiters.js";
import { verifyToken, isAdmin } from "../middleware/auth.js";
import upload from "../middleware/upload.js";

const router = express.Router();

/* Public Routes */
router.post("/forgot-password", adminResetLimiter, forgotAdminPassword);
router.post("/reset-password", adminResetLimiter, resetAdminPassword);

// Apply auth protection and admin check to all admin routes
router.use(verifyToken, isAdmin);

// Coupons

router.post("/coupons", createCoupon);

router.get("/coupons", getAdminCoupons);

router.patch("/coupons/:couponId/status", toggleCouponStatus);

router.delete("/coupons/:couponId", deleteCoupon);

// Products
router.post("/products", upload.array("images", 10), addProduct);
router.put("/products/:id", upload.array("images", 10), editProduct);
router.delete("/products/:id", deleteProduct);

router.get("/products/:productId/reviews", getProductReviewsAdmin);

router.delete("/reviews/:reviewId", deleteReview);

// Orders
router.get("/orders", getAdminOrders);
router.put("/orders/:orderId/status", updateOrderStatus);
router.get("/orders/:orderId", getAdminOrderById);

// Customers
router.get("/users", getAdminUsers);
router.put("/users/:userId/block", toggleBlockUser);

// Analytics Reports
router.get("/reports", getAdminReports);

export default router;
