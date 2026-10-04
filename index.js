import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import connectDB from "./config/db.js";

// Import Routes
import authRoutes from "./routes/authRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import wishlistRoutes from "./routes/wishlistRoutes.js";
import shiprocketWebhookRoutes from "./routes/shiprocketWebhookRoutes.js";
import razorpayWebhookRoutes from "./routes/razorpayWebhookRoutes.js";

import { requireCsrf } from "./middleware/csrf.js";

import orderRoutes from "./routes/orderRoutes.js";
import couponRoutes from "./routes/couponRoutes.js";
import addressRoutes from "./routes/addressRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import shiprocketRoutes from "./routes/shiprocketRoutes.js";
import contactRoutes from "./routes/contactRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import cookieParser from "cookie-parser";
import instagramRoutes from "./routes/instagramRoutes.js";
import { chatLimiter } from "./middleware/authRateLimiters.js";
import {
  isManualCapturePolicyEnabled,
} from "./config/razorpay.js";
import { reconcileExpiredPrepaidReservations } from "./services/paymentService.js";

dotenv.config();

// Connect to MongoDB
connectDB();

const app = express();
// Trust Render's reverse proxy
app.set("trust proxy", 1);
const PORT = process.env.PORT || 5000;

// Resolve __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Security Middleware
app.use(
  helmet({
    crossOriginResourcePolicy: false, // crucial for serving local uploaded files to react
  }),
);

const allowedOrigins = [
  "https://frontend-perfume-eight.vercel.app",
  "http://localhost:3000",
  "https://bhatkarco.com",
  "https://www.bhatkarco.com",
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no Origin (Postman, server-to-server)
    if (!origin) {
      return callback(null, false);
    }

    // Allow only whitelisted origins
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },

  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
};

app.use(cors(corsOptions));

// Use cookie parser middleware
app.use(cookieParser());

const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many webhook requests.",
  },
});

//webhooks
app.use("/api/webhooks/razorpay", webhookLimiter, razorpayWebhookRoutes);
app.use("/api/webhooks/shiprocket", webhookLimiter, shiprocketWebhookRoutes);

// Chat has a smaller route-specific body limit than the global API parser.
app.use(
  "/api/chat",
  chatLimiter,
  express.json({ limit: "8kb" }),
  (error, req, res, next) => {
    if (error?.type === "entity.too.large") {
      return res.status(413).json({ message: "Chat request is too large." });
    }
    if (error?.type === "entity.parse.failed") {
      return res.status(400).json({ message: "Invalid chat request." });
    }
    return next(error);
  },
  requireCsrf,
  chatRoutes,
);

// JSON Request Parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static upload fallback directory & public assets
app.use("/uploads", express.static(path.join(__dirname, "public", "uploads")));
app.use(express.static(path.join(__dirname, "public")));

// Rate Limiting (2000 requests in development, 200 in production)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "production" ? 200 : 2000,
  message: {
    message:
      "Too many requests from this IP, please try again after 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", apiLimiter);
app.use("/api", requireCsrf);

// API Routing Mapping
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/wishlist", wishlistRoutes);

app.use("/api/orders", orderRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/addresses", addressRoutes);
app.use("/api/user", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/shiprocket", shiprocketRoutes);
app.use("/api/instagram", instagramRoutes);
app.use("/api/general", contactRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "UP",
    message: "Bhatkar Perfumes Server is running fine.",
  });
});

// Root route
app.get("/", (req, res) => {
  res.json({ message: "Welcome to Bhatkar Perfumes backend server." });
});

// 404 Route handler
app.use((req, res) => {
  res.status(404).json({ message: "Resource not found." });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Unhandled Server Error:", err.stack || err);
  const status = err.statusCode || 500;
  res.status(status).json({
    message: err.message || "Internal Server Error",
    error: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`Bhatkar Perfumes backend server listening on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);

  if (isManualCapturePolicyEnabled()) {
    let reconciliationRunning = false;
    setInterval(async () => {
      if (reconciliationRunning) {
        return;
      }

      reconciliationRunning = true;
      try {
        await reconcileExpiredPrepaidReservations();
      } catch (error) {
        console.error(
          "Prepaid reservation reconciliation failed:",
          error.message,
        );
      } finally {
        reconciliationRunning = false;
      }
    }, 5 * 60 * 1000).unref();
  } else {
    console.warn(
      "Prepaid reservation expiry is disabled; verify manual capture with a 72-hour timeout and Direct Settlement disabled, then set the corresponding Razorpay policy environment values.",
    );
  }
});
