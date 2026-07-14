import express from 'express';
import {
  createOrder,
  verifyPayment,
  getUserOrders,
  getOrderById,
  downloadInvoice,
  applyCoupon,
} from '../controllers/orderController.js';
import { verifyToken } from '../middleware/auth.js';

const router = express.Router();

router.post('/create', verifyToken, createOrder);
router.post('/verify', verifyToken, verifyPayment);
router.get('/my-orders', verifyToken, getUserOrders);
router.get('/my-orders/:orderId', verifyToken, getOrderById);
router.get('/invoice/:orderId', verifyToken, downloadInvoice);
router.post('/apply-coupon', verifyToken, applyCoupon);

export default router;
