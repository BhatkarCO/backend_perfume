import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import User from "../models/User.js";
import OTP from "../models/OTP.js";
import { sendOTPEmail } from "../utils/resendEmail.js";
import { generateOTP } from "../utils/otp.js";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "supersecretscentoraauthkey";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

/**
 * Register User
 */
export const register = async (req, res) => {
  const { email, password, name, phone } = req.body;

  if (!email || !password || !name) {
    return res
      .status(400)
      .json({ message: "Email, password, and name are required." });
  }

  try {
    // Check if verified user already exists
    const checkUser = await User.findOne({ email: email.toLowerCase() });
    if (checkUser && checkUser.is_verified) {
      return res.status(400).json({ message: "Email already registered." });
    }

    // Check if an unverified registration already exists
    const existingOTP = await OTP.findOne({ email: email.toLowerCase(), purpose: "register" });
    if (existingOTP) {
      // Prevent OTP resend more than once every 60 seconds
      const elapsed = Date.now() - new Date(existingOTP.lastSentAt).getTime();
      if (elapsed < 60000) {
        return res.status(429).json({
          message: `Please wait ${Math.ceil((60000 - elapsed) / 1000)} seconds before requesting a new OTP.`
        });
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Generate OTP
    const otp = generateOTP();
    const hashedOTP = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store or replace OTP record
    if (existingOTP) {
      existingOTP.otp = hashedOTP;
      existingOTP.userData = { name, password: passwordHash, phone: phone || null };
      existingOTP.expiresAt = expiresAt;
      existingOTP.attempts = 0;
      existingOTP.lastSentAt = new Date();
      existingOTP.verified = false;
      await existingOTP.save();
    } else {
      const otpDoc = new OTP({
        email: email.toLowerCase(),
        otp: hashedOTP,
        purpose: "register",
        userData: { name, password: passwordHash, phone: phone || null },
        expiresAt,
        lastSentAt: new Date()
      });
      await otpDoc.save();
    }

    // Send OTP email via Resend
    await sendOTPEmail(email.toLowerCase(), otp);

    res.status(200).json({
      message: "Verification OTP sent to your email."
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * Login User
 */
export const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ message: "Email and password are required." });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ message: "Invalid email or password." });
    }

    // Check if user is verified
    if (!user.is_verified) {
      return res.status(400).json({ message: "Email not verified. Please register again." });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(400).json({ message: "Invalid email or password." });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      {
        expiresIn: JWT_EXPIRES_IN,
      },
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite:
        process.env.NODE_ENV === "production"
          ? "None"
          : "Lax",  // Set to "None" for cross-site cookies in production, "Lax" for development

      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(200).json({
      message: "Login successful.",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        is_verified: user.is_verified,
      }
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * Verify Registration OTP
 */
export const verifyOTP = async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ message: "Email and OTP are required." });
  }

  try {
    const otpRecord = await OTP.findOne({ email: email.toLowerCase(), purpose: "register" });
    if (!otpRecord) {
      return res.status(400).json({ message: "Verification record not found or expired. Please register again." });
    }

    // Check attempts limit (max 5 attempts)
    if (otpRecord.attempts >= 5) {
      return res.status(400).json({ message: "Maximum verification attempts exceeded. Please register again." });
    }

    // Increment attempts
    otpRecord.attempts += 1;
    await otpRecord.save();

    // Check expiration
    if (new Date() > otpRecord.expiresAt) {
      return res.status(400).json({ message: "OTP has expired. Please register again." });
    }

    // Compare OTP
    const isMatch = await bcrypt.compare(otp, otpRecord.otp);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid OTP code." });
    }

    // If valid, create user
    const { name, password, phone } = otpRecord.userData;

    // Clean up if there's any existing unverified user model (precaution)
    await User.deleteOne({ email: email.toLowerCase() });

    const user = new User({
      email: email.toLowerCase(),
      password_hash: password,
      name,
      phone: phone || null,
      is_verified: true
    });

    await user.save();

    // Delete OTP record immediately
    await OTP.deleteOne({ _id: otpRecord._id });

    // Generate JWT token so user gets logged in immediately
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      {
        expiresIn: JWT_EXPIRES_IN,
      },
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite:
        process.env.NODE_ENV === "production"
          ? "None"
          : "Lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      message: "Email verified successfully.",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        is_verified: true,
      }
    });
  } catch (error) {
    console.error("OTP verification error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * Resend OTP (Registration or Forgot Password)
 */
export const resendOTP = async (req, res) => {
  const { email, purpose = "register" } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required." });
  }

  try {
    const otpRecord = await OTP.findOne({ email: email.toLowerCase(), purpose });
    if (!otpRecord) {
      return res.status(400).json({ message: "Verification record not found or expired." });
    }

    // Prevent OTP resend more than once every 60 seconds
    const elapsed = Date.now() - new Date(otpRecord.lastSentAt).getTime();
    if (elapsed < 60000) {
      return res.status(429).json({
        message: `Please wait ${Math.ceil((60000 - elapsed) / 1000)} seconds before requesting a new OTP.`
      });
    }

    // Generate new OTP
    const otp = generateOTP();
    const hashedOTP = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    otpRecord.otp = hashedOTP;
    otpRecord.expiresAt = expiresAt;
    otpRecord.attempts = 0; // reset attempts
    otpRecord.lastSentAt = new Date();
    otpRecord.verified = false;
    await otpRecord.save();

    // Send email
    await sendOTPEmail(email.toLowerCase(), otp);

    res.status(200).json({ message: "A new OTP has been sent to your email." });
  } catch (error) {
    console.error("Resend OTP error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * Forgot Password
 */
export const forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required." });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // For security, do not reveal if the email exists. Return success message anyway.
      return res.status(200).json({ message: "If email exists, a reset code has been sent." });
    }

    // Check if a forgot password OTP already exists to enforce 60s rule
    const existingOTP = await OTP.findOne({ email: email.toLowerCase(), purpose: "forgot-password" });
    if (existingOTP) {
      const elapsed = Date.now() - new Date(existingOTP.lastSentAt).getTime();
      if (elapsed < 60000) {
        return res.status(429).json({
          message: `Please wait ${Math.ceil((60000 - elapsed) / 1000)} seconds before requesting a new OTP.`
        });
      }
    }

    const otp = generateOTP();
    const hashedOTP = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    if (existingOTP) {
      existingOTP.otp = hashedOTP;
      existingOTP.expiresAt = expiresAt;
      existingOTP.attempts = 0;
      existingOTP.lastSentAt = new Date();
      existingOTP.verified = false;
      await existingOTP.save();
    } else {
      const otpDoc = new OTP({
        email: email.toLowerCase(),
        otp: hashedOTP,
        purpose: "forgot-password",
        expiresAt,
        lastSentAt: new Date()
      });
      await otpDoc.save();
    }

    // Send email via Resend
    await sendOTPEmail(email.toLowerCase(), otp);

    res.status(200).json({ message: "If email exists, a reset code has been sent." });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * Verify Forgot Password OTP
 */
export const verifyForgotPasswordOTP = async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ message: "Email and OTP are required." });
  }

  try {
    const otpRecord = await OTP.findOne({ email: email.toLowerCase(), purpose: "forgot-password" });
    if (!otpRecord) {
      return res.status(400).json({ message: "Reset code not found or expired. Please request again." });
    }

    // Check attempts limit (max 5 attempts)
    if (otpRecord.attempts >= 5) {
      return res.status(400).json({ message: "Maximum reset code attempts exceeded. Please try again." });
    }

    // Increment attempts
    otpRecord.attempts += 1;
    await otpRecord.save();

    // Check expiration
    if (new Date() > otpRecord.expiresAt) {
      return res.status(400).json({ message: "Reset code has expired. Please try again." });
    }

    // Compare OTP
    const isMatch = await bcrypt.compare(otp, otpRecord.otp);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid OTP code." });
    }

    // Mark as verified
    otpRecord.verified = true;
    await otpRecord.save();

    res.status(200).json({ message: "OTP verified successfully. You can now reset your password." });
  } catch (error) {
    console.error("Verify forgot password OTP error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * Reset Password
 */
export const resetPassword = async (req, res) => {
  const { email, newPassword } = req.body;

  if (!email || !newPassword) {
    return res.status(400).json({ message: "Email and new password are required." });
  }

  try {
    // Check if they verified the OTP first
    const otpRecord = await OTP.findOne({ email: email.toLowerCase(), purpose: "forgot-password" });
    if (!otpRecord || !otpRecord.verified) {
      return res.status(400).json({ message: "Password reset request unauthorized. Please verify OTP first." });
    }

    // Check expiration of OTP
    if (new Date() > otpRecord.expiresAt) {
      return res.status(400).json({ message: "Reset code has expired. Please verify OTP again." });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ message: "User not found." });
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Update user password
    user.password_hash = newPasswordHash;
    user.is_verified = true;
    await user.save();

    // Delete OTP record immediately after successful reset
    await OTP.deleteOne({ _id: otpRecord._id });

    res.status(200).json({ message: "Password updated successfully. You can now login." });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * Get Current Logged-in User
 */
export const getCurrentUser = async (req, res) => {
  try {
    res.status(200).json({
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        role: req.user.role,
        is_verified: req.user.is_verified,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch user.",
    });
  }
};

//logout user and clear the token cookie
export const logout = (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite:
      process.env.NODE_ENV === "production"
        ? "None"
        : "Lax",
  });

  res.status(200).json({
    message: "Logged out successfully.",
  });
};