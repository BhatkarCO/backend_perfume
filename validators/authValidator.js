import { z } from "zod";

/**
 * Register
 */
export const registerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3, "Name must be at least 3 characters")
      .max(50, "Name cannot exceed 50 characters"),

    email: z
      .string()
      .trim()
      .email("Invalid email address"),

    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(100)
      .refine(
        (password) =>
          /[A-Z]/.test(password) &&
          /[a-z]/.test(password) &&
          /[0-9]/.test(password) &&
          /[^A-Za-z0-9]/.test(password),
        {
          message:
            "Password must contain an uppercase letter, lowercase letter, number and special character.",
        }
      ),

    phone: z
      .string()
      .regex(/^[6-9]\d{9}$/, "Invalid Indian phone number"),
  })
  .strict();

/**
 * Login
 */
export const loginSchema = z
  .object({
    email: z.string().trim().email("Invalid email address"),

    password: z.string().min(1, "Password is required"),
  })
  .strict();

/**
 * Verify OTP
 */
export const otpSchema = z
  .object({
  email: z.string().trim().email(),

  otp: z
    .string()
    .length(6, "OTP must contain exactly 6 digits"),
  })
  .strict();

/**
 * Resend OTP
 */
export const resendOTPSchema = z
  .object({
  email: z.string().trim().email(),

  purpose: z
    .enum(["register", "forgot-password"])
    .default("register"),
  })
  .strict();

/**
 * Forgot Password
 */
export const forgotPasswordSchema = z
  .object({
    email: z.string().trim().email(),
  })
  .strict();

/**
 * Reset Password
 */
export const resetPasswordSchema = z
  .object({
    email: z.string().trim().email(),

  newPassword: z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(100)
  .refine(
    (password) =>
      /[A-Z]/.test(password) &&
      /[a-z]/.test(password) &&
      /[0-9]/.test(password) &&
      /[^A-Za-z0-9]/.test(password),
    {
      message:
        "Password must contain an uppercase letter, lowercase letter, number and special character.",
    }
  ),
  }) 
  .strict();