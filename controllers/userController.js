import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Address from '../models/Address.js';
import Wishlist from '../models/Wishlist.js';
import Review from '../models/Review.js';
import Order from '../models/Order.js';
import crypto from "crypto";
import OTP from "../models/OTP.js";
import { sendOTPEmail } from "../utils/resendEmail.js";
import { generateOTP } from "../utils/otp.js";

/**
 * Get user profile details
 */
  export const getUserProfile = async (req, res) => {
  const userId = req.user.id;

  try {
    const user = await User.findById(userId).select('id email role name phone is_verified created_at');

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.status(200).json(user);
  } catch (error) {
    console.error('Fetch user profile error:', error);
    res.status(500).json({ message: 'Error retrieving profile.' });
  }
};

/**
 * Update user profile details
 */
export const updateUserProfile = async (req, res) => {
  const userId = req.user.id;
  const { name, phone } = req.body;

  if (!name) {
    return res.status(400).json({ message: 'Name is required.' });
  }

  try {
    const user = await User.findByIdAndUpdate(
      userId,
      { name, phone: phone || null },
      { new: true }
    ).select('id email role name phone is_verified');

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.status(200).json({ message: 'Profile updated successfully.', user });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Error updating profile.' });
  }
};

/**
 * Change password
 */
export const changePassword = async (req, res) => {
  const userId = req.user.id;
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ message: 'Old and new passwords are required.' });
  }

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Check old password
    const isMatch = await bcrypt.compare(oldPassword, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ message: 'Incorrect old password.' });
    }

    // Hash and save new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    user.password_hash = newPasswordHash;
    await user.save();

    res.status(200).json({ message: 'Password updated successfully.' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Error updating password.' });
  }
};

/**
 * Request OTP before deleting account
 */
export const requestDeleteAccountOTP = async (req, res) => {
  const userId = req.user.id;

  try {
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    // Prevent Super Admin from deleting account
    if (user.email === process.env.SUPER_ADMIN_EMAIL) {
      return res.status(403).json({
        message: "The Super Admin account cannot be deleted.",
      });
    }

    // Check if OTP already exists
    let existingOTP = await OTP.findOne({
      email: user.email,
      purpose: "delete-account",
    });

    // 60-second resend limit
    if (existingOTP) {
      const elapsed =
        Date.now() - new Date(existingOTP.lastSentAt).getTime();

      if (elapsed < 60000) {
        return res.status(429).json({
          message: `Please wait ${Math.ceil(
            (60000 - elapsed) / 1000
          )} seconds before requesting another OTP.`,
        });
      }
    }

    // Generate OTP
    const otp = generateOTP();
    const hashedOTP = await bcrypt.hash(otp, 10);

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    if (existingOTP) {
      existingOTP.otp = hashedOTP;
      existingOTP.expiresAt = expiresAt;
      existingOTP.attempts = 0;
      existingOTP.lastSentAt = new Date();
      existingOTP.verified = false;

      await existingOTP.save();
    } else {
      existingOTP = new OTP({
        email: user.email,
        otp: hashedOTP,
        purpose: "delete-account",
        expiresAt,
        lastSentAt: new Date(),
      });

      await existingOTP.save();
    }

    await sendOTPEmail(user.email, otp);

    return res.status(200).json({
      message: "OTP sent to your registered email.",
    });

  } catch (error) {
    console.error("Delete account OTP error:", error);

    return res.status(500).json({
      message: "Internal server error.",
    });
  }
};

/**
 * Delete user account
 */
export const deleteUserAccount = async (req, res) => {
  const userId = req.user.id;
  const { otp } = req.body;

  if (!otp) {
    return res.status(400).json({
      message: "OTP is required to delete your account.",
    });
  }

  try {
    // Get the current user
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    // Prevent deleting the Super Admin account
    if (user.email === process.env.SUPER_ADMIN_EMAIL) {
      return res.status(403).json({
        message: "The Super Admin account cannot be deleted.",
      });
    }

    // Prevent deleting the last remaining admin
    if (user.role === "admin") {
      const adminCount = await User.countDocuments({ role: "admin" });

      if (adminCount <= 1) {
        return res.status(403).json({
          message: "Cannot delete the last remaining admin account.",
        });
      }
    }

    // Find delete-account OTP
    const otpRecord = await OTP.findOne({
      email: user.email,
      purpose: "delete-account",
    });

    if (!otpRecord) {
      return res.status(400).json({
        message: "No deletion OTP found. Please request a new OTP.",
      });
    }

    // Maximum attempts
    if (otpRecord.attempts >= 5) {
      return res.status(400).json({
        message: "Maximum OTP attempts exceeded. Please request a new OTP.",
      });
    }

    // Increment attempts
    otpRecord.attempts += 1;
    await otpRecord.save();

    // Check expiry
    if (new Date() > otpRecord.expiresAt) {
      await OTP.deleteOne({ _id: otpRecord._id });

      return res.status(400).json({
        message: "OTP has expired. Please request a new one.",
      });
    }

    // Verify OTP
    const isMatch = await bcrypt.compare(otp, otpRecord.otp);

    if (!isMatch) {
      return res.status(400).json({
        message: "Invalid OTP.",
      });
    }

    // OTP verified → remove it
    await OTP.deleteOne({ _id: otpRecord._id });

    // Delete associated addresses
    await Address.deleteMany({ user_id: userId });

    // Delete associated wishlists
    await Wishlist.deleteMany({ user_id: userId });

    // Disassociate reviews
    await Review.updateMany(
      { user_id: userId },
      { $unset: { user_id: 1 } }
    );

    // Disassociate orders
    await Order.updateMany(
      { user_id: userId },
      { $unset: { user_id: 1 } }
    );

    // Delete user
    await User.findByIdAndDelete(userId);

    // Logout by clearing cookie
    res.clearCookie("token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "None",
    });

    return res.status(200).json({
      message: "Account deleted successfully.",
    });

  } catch (error) {
    console.error("Delete account error:", error);

    return res.status(500).json({
      message: "Error deleting account.",
    });
  }
};