import express from "express";
import {
  register,
  login,
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

const router = express.Router();

router.post("/register",validate(registerSchema), register);
router.post("/login", validate(loginSchema), login);
router.post("/verify-otp",validate(otpSchema), verifyOTP);
router.post("/resend-otp",validate(resendOTPSchema), resendOTP);
router.post("/forgot-password",validate(forgotPasswordSchema), forgotPassword);
router.post("/verify-forgot-password",validate(otpSchema), verifyForgotPasswordOTP);
router.post("/reset-password",validate(resetPasswordSchema), resetPassword);
router.post("/logout", logout);
router.get("/me", verifyToken, getCurrentUser);

export default router;
