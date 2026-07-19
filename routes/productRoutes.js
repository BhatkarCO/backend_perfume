import express from "express";
import {
  getProducts,
  getProductBySlug,
  getProductReviews,
  addProductReview,
} from "../controllers/productController.js";
import { verifyToken, isVerified } from "../middleware/auth.js";

const router = express.Router();
import Product from "../models/Product.js";

router.get("/", getProducts);
router.get("/:productId/reviews", getProductReviews);
router.post("/:productId/reviews", verifyToken, isVerified, addProductReview);
router.get("/:slug", getProductBySlug);

router.post("/", async (req, res) => {
  try {
    const product = new Product(req.body);

    await product.save();

    // Send product data to python embedding service
    try {
      await fetch("http://127.0.0.1:8000/embed_product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(product),
      });
    } catch (embedErr) {
      console.error("Failed to embed product in vector DB:", embedErr.message);
    }

    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

// Get All Products

router.get("/", async (req, res) => {
  try {
    const products = await Product.find();

    res.json(products);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});
export default router;
