import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import User from "../models/User.js";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error(
    "JWT_SECRET must be configured and at least 32 characters long.",
  );
}

/**
 * Verify JWT token middleware
 */
export const verifyToken = async (req, res, next) => {
  const token = req.cookies.token;

  if (!token) {
    return res.status(401).json({
      message: "Access denied. No token provided.",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
    });

    if (!decoded?.id) {
      return res.status(401).json({
        message: "Invalid token.",
      });
    }

    const user = await User.findById(decoded.id).select(
      "email role name is_verified session_version",
    );

    if (!user) {
      return res.status(401).json({
        message: "User no longer exists.",
      });
    }

    if (user.role === "blocked") {
      return res.status(403).json({
        message: "Your account has been blocked.",
      });
    }

    const currentSessionVersion = Number(user.session_version || 0);
    const tokenSessionVersion = Number(decoded.session_version);

    if (
      !Number.isInteger(tokenSessionVersion) ||
      tokenSessionVersion !== currentSessionVersion
    ) {
      return res.status(401).json({
        message: "Session expired. Please login again.",
      });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res
        .status(401)
        .json({ message: "Token expired. Please login again." });
    }
    return res.status(401).json({ message: "Invalid token." });
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
    return res.status(403).json({
      message: "Access denied. Email verification required.",
      requires_verification: true,
    });
  }
  next();
};
