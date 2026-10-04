import express from "express";
import { z } from "zod";
import { chatWithAI } from "../controllers/chatController.js";
import { validate } from "../middleware/validate.js";

const router = express.Router();

export const chatSchema = z
  .object({
    session_id: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(2000),
  })
  .strict();

router.post("/", validate(chatSchema), chatWithAI);

export default router;