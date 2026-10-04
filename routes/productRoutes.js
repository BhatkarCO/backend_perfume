import express from "express";
import {
  getProducts,
  getProductBySlug,
  getProductReviews,
  addProductReview,
} from "../controllers/productController.js";
import { z } from "zod";
import { verifyToken, isAdmin, isVerified } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = express.Router();
import Product from "../models/Product.js";

const productCreationSchema = z
  .object({
    name: z.string().min(1).max(200),
    slug: z.string().min(1).max(200),
    description: z.string().min(1).max(10000),
    short_description: z.string().max(2000).nullable().optional(),
    price: z.coerce.number().finite(),
    sale_price: z.coerce.number().finite().nullable().optional(),
    delivery_charge: z.coerce.number().finite().optional(),
    gst_percentage: z.coerce.number().finite().optional(),
    stock_quantity: z.coerce.number().int().optional(),
    category_id: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/)
      .nullable()
      .optional(),
    gender: z.enum(["Men", "Women", "Unisex"]).nullable().optional(),
    rating: z.coerce.number().finite().optional(),
    is_featured: z.boolean().optional(),
    is_best_selling: z.boolean().optional(),
    is_new_arrival: z.boolean().optional(),
    fragrance_notes: z
      .object({
        top: z.array(z.string()).optional(),
        heart: z.array(z.string()).optional(),
        base: z.array(z.string()).optional(),
      })
      .strict()
      .nullable()
      .optional(),
    video_url: z.string().max(2048).nullable().optional(),
    images: z
      .array(
        z
          .object({
            image_url: z.string().min(1).max(2048),
            public_id: z.string().optional(),
            is_primary: z.boolean().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

router.get("/", getProducts);
router.get("/:productId/reviews", getProductReviews);
router.post("/:productId/reviews", verifyToken, isVerified, addProductReview);
router.get("/:slug", getProductBySlug);

router.post(
  "/",
  verifyToken,
  isAdmin,
  validate(productCreationSchema),
  async (req, res) => {
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
        console.error(
          "Failed to embed product in vector DB:",
          embedErr.message,
        );
      }

      res.status(201).json(product);
    } catch (err) {
      res.status(500).json({
        message: err.message,
      });
    }
  },
);

export default router;
