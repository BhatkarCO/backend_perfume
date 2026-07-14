import express from "express";
import {
  getProducts,
  getProductBySlug,
  getProductReviews,
  addProductReview,
} from "../controllers/productController.js";
import { verifyToken, isVerified } from "../middleware/auth.js";

const router = express.Router();

router.get("/", getProducts);
router.get("/:productId/reviews", getProductReviews);
router.post("/:productId/reviews", verifyToken, isVerified, addProductReview);
router.get("/:slug", getProductBySlug);

export default router;
