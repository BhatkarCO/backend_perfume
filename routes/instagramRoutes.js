import express from "express";
import { getInstagramFeed } from "../controllers/instagramController.js";

const router = express.Router();

router.get("/feed", getInstagramFeed);

export default router;