import express from 'express';
import {
  addProduct,
  editProduct,
  deleteProduct,
  getAdminOrders,
  updateOrderStatus,
  getAdminUsers,
  toggleBlockUser,
  getAdminReports,
  forgotAdminPassword,
  resetAdminPassword,
} from '../controllers/adminController.js';
import { verifyToken, isAdmin } from '../middleware/auth.js';
import upload from '../middleware/upload.js';

const router = express.Router();

/* Public Routes */
router.post("/forgot-password", forgotAdminPassword);
router.post("/reset-password", resetAdminPassword);

// Apply auth protection and admin check to all admin routes
router.use(verifyToken, isAdmin);

// Products
router.post('/products', upload.array('images', 10), addProduct);
router.put('/products/:id', upload.array('images', 10), editProduct);
router.delete('/products/:id', deleteProduct);

// Orders
router.get('/orders', getAdminOrders);
router.put('/orders/:orderId/status', updateOrderStatus);

// Customers
router.get('/users', getAdminUsers);
router.put('/users/:userId/block', toggleBlockUser);

// Analytics Reports
router.get('/reports', getAdminReports);

export default router;
