import express from 'express';
import { getUserProfile, updateUserProfile, changePassword, deleteUserAccount } from '../controllers/userController.js';
import { verifyToken } from '../middleware/auth.js';
import { requestDeleteAccountOTP } from '../controllers/userController.js';
import { otpLimiter } from '../middleware/authRateLimiters.js';

const router = express.Router();

router.get('/profile', verifyToken, getUserProfile);
router.put('/profile', verifyToken, updateUserProfile);
router.put('/password', verifyToken, changePassword);
router.post("/profile/delete-request", otpLimiter, verifyToken, requestDeleteAccountOTP)
router.delete("/profile", otpLimiter, verifyToken, deleteUserAccount);

export default router;
