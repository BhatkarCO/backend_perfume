import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import dotenv from "dotenv";
import User from "../models/User.js";
import {
  createGoogleOAuthState,
  getGoogleAuthUrl,
  exchangeGoogleCode,
} from "../utils/googleAuth.js";
import OTP from "../models/OTP.js";
import { sendOTPEmail } from "../utils/resendEmail.js";
import { generateOTP } from "../utils/otp.js";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not configured.");
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

const getCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === "production";
  const secure =
    process.env.COOKIE_SECURE === "true" ||
    (process.env.COOKIE_SECURE === undefined && isProduction);
  const sameSiteValue = (
    process.env.COOKIE_SAMESITE || (secure ? "None" : "Lax")
  ).toLowerCase();

  const sameSite =
    sameSiteValue === "none"
      ? "None"
      : sameSiteValue === "strict"
        ? "Strict"
        : "Lax";

  const options = {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };

  if (process.env.COOKIE_DOMAIN) {
    options.domain = process.env.COOKIE_DOMAIN;
  }

  return options;
};

const getClearCookieOptions = () => {
  const options = getCookieOptions();
  delete options.maxAge;
  return options;
};

const getPasswordResetCookieOptions = () => ({
  ...getCookieOptions(),
  path: "/api/auth",
  maxAge: 10 * 60 * 1000,
});

const getClearPasswordResetCookieOptions = () => {
  const options = getPasswordResetCookieOptions();
  delete options.maxAge;
  return options;
};

const createAppToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      session_version: Number(user.session_version || 0),
    },
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES_IN,
      algorithm: "HS256",
    },
  );
};

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

    const normalizedEmail = email.toLowerCase();
    const existingOTP = await OTP.findOne({
      email: normalizedEmail,
      purpose: "register",
    });
    if (existingOTP) {
      // Prevent OTP resend more than once every 60 seconds
      const elapsed = Date.now() - new Date(existingOTP.lastSentAt).getTime();
      if (elapsed < 60000) {
        return res.status(429).json({
          message: `Please wait ${Math.ceil((60000 - elapsed) / 1000)} seconds before requesting a new OTP.`,
        });
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Generate OTP
    const otp = generateOTP();
    const hashedOTP = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Replace the registration challenge without resetting its attempt count.
    if (existingOTP) {
      const updatedOTP = await OTP.findOneAndUpdate(
        {
          _id: existingOTP._id,
          lastSentAt: existingOTP.lastSentAt,
          attempts: { $lt: 5 },
        },
        {
          $set: {
            otp: hashedOTP,
            userData: {
              name,
              password: passwordHash,
              phone: phone || null,
            },
            expiresAt,
            lastSentAt: new Date(),
            verified: false,
          },
        },
      );
      if (!updatedOTP) {
        return res.status(429).json({
          message: "Please wait before requesting another OTP.",
        });
      }
    } else {
      const otpDoc = new OTP({
        email: normalizedEmail,
        otp: hashedOTP,
        purpose: "register",
        userData: { name, password: passwordHash, phone: phone || null },
        expiresAt,
        lastSentAt: new Date(),
      });
      try {
        await otpDoc.save();
      } catch (error) {
        if (error?.code === 11000) {
          return res.status(429).json({
            message: "Please wait before requesting another OTP.",
          });
        }
        throw error;
      }
    }

    // Send OTP email via Resend
    await sendOTPEmail(email.toLowerCase(), otp);

    res.status(200).json({
      message: "Verification OTP sent to your email.",
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
      return res
        .status(400)
        .json({ message: "Email not verified. Please register again." });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(400).json({ message: "Invalid email or password." });
    }

    // Generate JWT
    const token = createAppToken(user);

    res.cookie("token", token, getCookieOptions());

    res.status(200).json({
      message: "Login successful.",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        is_verified: user.is_verified,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * Start Google OAuth
 */
export const googleAuth = async (req, res) => {
  try {
    const state = createGoogleOAuthState();

    res.cookie("google_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60 * 1000, // 10 minutes
    });

    const authUrl = getGoogleAuthUrl(state);

    return res.redirect(authUrl);
  } catch (error) {
    console.error("Google OAuth initialization failed.");

    return res.status(500).json({
      message: "Unable to start Google authentication.",
    });
  }
};

/**
 * Google OAuth callback
 */
export const googleAuthCallback = async (req, res) => {
  try {
    const { code, state } = req.query;

    const savedState = req.cookies.google_oauth_state;

    if (!state || !savedState || state !== savedState) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/login?error=invalid_oauth_state`,
      );
    }

    res.clearCookie("google_oauth_state", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });

    if (!code) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/login?error=google_code_missing`,
      );
    }

    const googleUser = await exchangeGoogleCode(code);

    const { googleId, email, name, emailVerified } = googleUser;

    if (emailVerified !== true) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/login?error=google_auth_failed`,
      );
    }

    let user = await User.findOne({ email });

    // ------------------------------------------------
    // Existing user
    // ------------------------------------------------

    if (user) {
      // Existing account with a different Google account
      if (user.google_id && user.google_id !== googleId) {
        return res.redirect(
          `${process.env.FRONTEND_URL}/login?error=google_account_mismatch`,
        );
      }

      // Link Google account to existing user
      user.google_id = googleId;

      user.is_verified = true;

      await user.save();
    }

    // ------------------------------------------------
    // New Google user
    // ------------------------------------------------
    else {
      user = await User.create({
        email,
        name,
        google_id: googleId,
        auth_provider: "google",
        is_verified: true,
        role: "user",
      });
    }

    // ------------------------------------------------
    // Create YOUR application's JWT
    // ------------------------------------------------

    const token = createAppToken(user);

    // ------------------------------------------------
    // Store JWT in HttpOnly cookie
    // ------------------------------------------------

    res.cookie("token", token, getCookieOptions());

    // ------------------------------------------------
    // Redirect to frontend
    // ------------------------------------------------

    return res.redirect(`${process.env.FRONTEND_URL}/dashboard`);
  } catch (error) {
    console.error("Google OAuth callback failed.");

    return res.redirect(
      `${process.env.FRONTEND_URL}/login?error=google_auth_failed`,
    );
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
    const now = new Date();
    const otpRecord = await OTP.findOneAndUpdate(
      {
        email: email.toLowerCase(),
        purpose: "register",
        expiresAt: { $gt: now },
        attempts: { $lt: 5 },
      },
      { $inc: { attempts: 1 } },
      { returnDocument: "after" },
    );
    if (!otpRecord) {
      return res.status(400).json({
        message: "Invalid, expired, or exhausted OTP. Please register again.",
      });
    }

    // Compare OTP
    const isMatch = await bcrypt.compare(otp, otpRecord.otp);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid OTP code." });
    }

    const consumedOTP = await OTP.findOneAndDelete({
      _id: otpRecord._id,
      otp: otpRecord.otp,
      expiresAt: { $gt: new Date() },
      attempts: { $lte: 5 },
    });
    if (!consumedOTP) {
      return res.status(400).json({ message: "Invalid or expired OTP code." });
    }

    // If valid, create user
    const { name, password, phone } = otpRecord.userData;

    const user = new User({
      email: email.toLowerCase(),
      password_hash: password,
      name,
      phone: phone || null,
      is_verified: true,
    });

    await user.save();

    // Generate JWT token so user gets logged in immediately
    const token = createAppToken(user);

    res.cookie("token", token, getCookieOptions());

    res.status(200).json({
      message: "Email verified successfully.",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        is_verified: true,
      },
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
    const otpRecord = await OTP.findOne({
      email: email.toLowerCase(),
      purpose,
    });
    if (!otpRecord) {
      return res
        .status(400)
        .json({ message: "Verification record not found or expired." });
    }

    // Prevent OTP resend more than once every 60 seconds
    const elapsed = Date.now() - new Date(otpRecord.lastSentAt).getTime();
    if (elapsed < 60000) {
      return res.status(429).json({
        message: `Please wait ${Math.ceil((60000 - elapsed) / 1000)} seconds before requesting a new OTP.`,
      });
    }

    // Generate a replacement without resetting accumulated verification attempts.
    const otp = generateOTP();
    const hashedOTP = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    const updatedOTP = await OTP.findOneAndUpdate(
      {
        _id: otpRecord._id,
        lastSentAt: otpRecord.lastSentAt,
        attempts: { $lt: 5 },
      },
      {
        $set: {
          otp: hashedOTP,
          expiresAt,
          lastSentAt: new Date(),
          verified: false,
          resetAuthorizationHash: null,
          resetAuthorizationExpiresAt: null,
        },
      },
      { returnDocument: "after" },
    );
    if (!updatedOTP) {
      return res.status(429).json({
        message: "OTP attempt limit reached or resend already processed.",
      });
    }

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
      return res
        .status(200)
        .json({ message: "If email exists, a reset code has been sent." });
    }

    // Check if a forgot password OTP already exists to enforce 60s rule
    const existingOTP = await OTP.findOne({
      email: email.toLowerCase(),
      purpose: "forgot-password",
    });
    if (existingOTP) {
      const elapsed = Date.now() - new Date(existingOTP.lastSentAt).getTime();
      if (elapsed < 60000) {
        return res.status(200).json({
          message: "If email exists, a reset code has been sent.",
        });
      }
    }

    const otp = generateOTP();
    const hashedOTP = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    if (existingOTP) {
      const updatedOTP = await OTP.findOneAndUpdate(
        {
          _id: existingOTP._id,
          lastSentAt: existingOTP.lastSentAt,
          attempts: { $lt: 5 },
        },
        {
          $set: {
            otp: hashedOTP,
            expiresAt,
            lastSentAt: new Date(),
            verified: false,
            userId: user._id,
            resetAuthorizationHash: null,
            resetAuthorizationExpiresAt: null,
          },
        },
      );
      if (!updatedOTP) {
        return res.status(200).json({
          message: "If email exists, a reset code has been sent.",
        });
      }
    } else {
      const otpDoc = new OTP({
        email: email.toLowerCase(),
        otp: hashedOTP,
        purpose: "forgot-password",
        userId: user._id,
        expiresAt,
        lastSentAt: new Date(),
      });
      await otpDoc.save();
    }

    // Send email via Resend
    await sendOTPEmail(email.toLowerCase(), otp);

    res
      .status(200)
      .json({ message: "If email exists, a reset code has been sent." });
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
    const normalizedEmail = email.toLowerCase();
    const now = new Date();
    const otpRecord = await OTP.findOneAndUpdate(
      {
        email: normalizedEmail,
        purpose: "forgot-password",
        verified: false,
        expiresAt: { $gt: now },
        attempts: { $lt: 5 },
        userId: { $exists: true },
      },
      { $inc: { attempts: 1 } },
      { returnDocument: "after" },
    );

    if (!otpRecord) {
      return res.status(400).json({
        message: "Invalid or expired reset code. Please request a new one.",
      });
    }

    const user = await User.findOne({
      _id: otpRecord.userId,
      email: normalizedEmail,
    });
    if (!user) {
      return res.status(400).json({
        message: "Invalid or expired reset code. Please request a new one.",
      });
    }

    const isMatch = await bcrypt.compare(otp, otpRecord.otp);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid OTP code." });
    }

    const resetAuthorization = crypto.randomBytes(32).toString("hex");
    const resetAuthorizationHash = crypto
      .createHash("sha256")
      .update(resetAuthorization)
      .digest("hex");
    const resetAuthorizationExpiresAt = new Date(
      Math.min(otpRecord.expiresAt.getTime(), Date.now() + 10 * 60 * 1000),
    );
    const authorizedRecord = await OTP.findOneAndUpdate(
      {
        _id: otpRecord._id,
        userId: otpRecord.userId,
        otp: otpRecord.otp,
        attempts: otpRecord.attempts,
        verified: false,
        expiresAt: { $gt: new Date() },
      },
      {
        $set: {
          verified: true,
          resetAuthorizationHash,
          resetAuthorizationExpiresAt,
        },
      },
      { returnDocument: "after" },
    );

    if (!authorizedRecord) {
      return res.status(400).json({
        message: "Invalid or expired reset code. Please request a new one.",
      });
    }

    res.cookie(
      "password_reset_token",
      resetAuthorization,
      getPasswordResetCookieOptions(),
    );

    res.status(200).json({
      message: "OTP verified successfully. You can now reset your password.",
    });
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
    return res
      .status(400)
      .json({ message: "Email and new password are required." });
  }

  try {
    const resetAuthorization = req.cookies.password_reset_token;
    if (!resetAuthorization) {
      return res.status(400).json({
        message:
          "Password reset request unauthorized. Please verify OTP first.",
      });
    }

    const normalizedEmail = email.toLowerCase();
    const resetAuthorizationHash = crypto
      .createHash("sha256")
      .update(resetAuthorization)
      .digest("hex");
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    const otpRecord = await OTP.findOneAndUpdate(
      {
        email: normalizedEmail,
        purpose: "forgot-password",
        verified: true,
        resetAuthorizationHash,
        resetAuthorizationExpiresAt: { $gt: new Date() },
        expiresAt: { $gt: new Date() },
        userId: { $exists: true },
      },
      {
        $unset: {
          resetAuthorizationHash: 1,
          resetAuthorizationExpiresAt: 1,
        },
      },
      { returnDocument: "after" },
    );

    if (!otpRecord) {
      return res.status(400).json({
        message:
          "Password reset request unauthorized. Please verify OTP first.",
      });
    }

    const user = await User.findOneAndUpdate(
      { _id: otpRecord.userId, email: normalizedEmail },
      {
        $set: {
          password_hash: newPasswordHash,
          is_verified: true,
        },
        $inc: { session_version: 1 },
      },
      { returnDocument: "after" },
    );

    if (!user) {
      res.clearCookie(
        "password_reset_token",
        getClearPasswordResetCookieOptions(),
      );
      return res.status(400).json({
        message:
          "Password reset request unauthorized. Please verify OTP first.",
      });
    }

    res.clearCookie(
      "password_reset_token",
      getClearPasswordResetCookieOptions(),
    );

    res
      .status(200)
      .json({ message: "Password updated successfully. You can now login." });
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
export const logout = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, {
      $inc: { session_version: 1 },
    });

    res.clearCookie("token", getClearCookieOptions());

    return res.status(200).json({
      message: "Logged out successfully.",
    });
  } catch (error) {
    console.error("Logout error:", error);

    return res.status(500).json({
      message: "Unable to logout.",
    });
  }
};
