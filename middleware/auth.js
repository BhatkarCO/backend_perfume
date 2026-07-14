import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import User from "../models/User.js";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "supersecretscentoraauthkey";

/**
 * Verify JWT token middleware
 */
export const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ message: "Access denied. No token provided." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if user still exists in database
    const user = await User.findById(decoded.id).select("email role name is_verified");
    if (!user) {
      return res.status(401).json({ message: "User no longer exists." });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res
        .status(401)
        .json({ message: "Token expired. Please login again." });
    }
    return res.status(400).json({ message: "Invalid token." });
  }
};

/**
 * Admin check middleware
 */
export const isAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res
      .status(403)
      .json({ message: "Forbidden. Admin authorization required." });
  }
  next();
};

/**
 * Verified user check middleware
 */
export const isVerified = (req, res, next) => {
  if (!req.user || !req.user.is_verified) {
    return res
      .status(403)
      .json({
        message: "Access denied. Email verification required.",
        requires_verification: true,
      });
  }
  next();
};
