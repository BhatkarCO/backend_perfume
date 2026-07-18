import express from 'express';
import { getUserProfile, updateUserProfile, changePassword, deleteUserAccount } from '../controllers/userController.js';
import { verifyToken } from '../middleware/auth.js';
import { requestDeleteAccountOTP } from '../controllers/userController.js';

const router = express.Router();

router.get('/profile', verifyToken, getUserProfile);
router.put('/profile', verifyToken, updateUserProfile);
router.put('/password', verifyToken, changePassword);
router.post("/profile/delete-request",verifyToken,requestDeleteAccountOTP)
router.delete("/profile",verifyToken,deleteUserAccount);

export default router;
