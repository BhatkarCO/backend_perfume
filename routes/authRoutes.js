import express from 'express';
import { 
  register, 
  login, 
  verifyOTP, 
  resendOTP, 
  forgotPassword, 
  verifyForgotPasswordOTP,
  resetPassword 
} from '../controllers/authController.js';

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/verify-otp', verifyOTP);
router.post('/resend-otp', resendOTP);
router.post('/forgot-password', forgotPassword);
router.post('/verify-forgot-password', verifyForgotPasswordOTP);
router.post('/reset-password', resetPassword);

export default router;
