import express from "express";
import {
  register,
  login,
  googleAuth,
  googleAuthCallback,
  verifyOTP,
  resendOTP,
  forgotPassword,
  verifyForgotPasswordOTP,
  resetPassword,
  getCurrentUser,
  logout,
} from "../controllers/authController.js";

import { validate } from "../middleware/validate.js";

import {
  registerSchema,
  loginSchema,
  otpSchema,
  resendOTPSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "../validators/authValidator.js";

import { verifyToken } from "../middleware/auth.js";
import { issueCsrfToken } from "../middleware/csrf.js";

import {
  loginLimiter,
  otpLimiter,
  passwordResetLimiter,
} from "../middleware/authRateLimiters.js";

const router = express.Router();

router.get("/csrf", issueCsrfToken);

router.post("/register", validate(registerSchema), register);
router.post("/login", loginLimiter, validate(loginSchema), login);
router.get("/google", googleAuth);

router.get("/google/callback", googleAuthCallback);
router.post("/verify-otp", otpLimiter, validate(otpSchema), verifyOTP);
router.post("/resend-otp", otpLimiter, validate(resendOTPSchema), resendOTP);
router.post(
  "/forgot-password",
  passwordResetLimiter,
  validate(forgotPasswordSchema),
  forgotPassword,
);
router.post(
  "/verify-forgot-password",
  otpLimiter,
  validate(otpSchema),
  verifyForgotPasswordOTP,
);
router.post(
  "/reset-password",
  passwordResetLimiter,
  validate(resetPasswordSchema),
  resetPassword,
);
router.post("/logout", verifyToken, logout);
router.get("/me", verifyToken, getCurrentUser);

export default router;
