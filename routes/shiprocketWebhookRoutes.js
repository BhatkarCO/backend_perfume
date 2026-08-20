import express from "express";

import {
  handleShiprocketWebhook,
} from "../controllers/shiprocketWebhookController.js";

const router = express.Router();

router.post("/", handleShiprocketWebhook);

export default router;