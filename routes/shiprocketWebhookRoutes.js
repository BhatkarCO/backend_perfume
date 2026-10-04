import express from "express";

import {
  handleShiprocketWebhook,
} from "../controllers/shiprocketWebhookController.js";

const router = express.Router();

router.post(
  "/",
  express.json({ limit: "64kb" }),
  handleShiprocketWebhook,
);

router.use((error, req, res, next) => {
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid webhook JSON." });
  }

  if (error?.type === "entity.too.large") {
    return res.status(413).json({ message: "Webhook payload is too large." });
  }

  return next(error);
});

export default router;