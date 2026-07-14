import express from 'express';
import { getUserProfile, updateUserProfile, changePassword, deleteUserAccount } from '../controllers/userController.js';
import { verifyToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/profile', verifyToken, getUserProfile);
router.put('/profile', verifyToken, updateUserProfile);
router.put('/password', verifyToken, changePassword);
router.delete('/profile', verifyToken, deleteUserAccount);

export default router;
