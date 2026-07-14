import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Address from '../models/Address.js';
import Wishlist from '../models/Wishlist.js';
import Review from '../models/Review.js';
import Order from '../models/Order.js';

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
 * Delete user account
 */
export const deleteUserAccount = async (req, res) => {
  const userId = req.user.id;

  try {
    // Delete associated addresses
    await Address.deleteMany({ user_id: userId });

    // Delete associated wishlists
    await Wishlist.deleteMany({ user_id: userId });

    // Disassociate reviews
    await Review.updateMany({ user_id: userId }, { $unset: { user_id: 1 } });

    // Disassociate orders
    await Order.updateMany({ user_id: userId }, { $unset: { user_id: 1 } });

    // Delete user document
    const user = await User.findByIdAndDelete(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.status(200).json({ message: 'Account deleted successfully.' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ message: 'Error deleting account.' });
  }
};
