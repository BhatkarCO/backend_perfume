import express from 'express';
import {
  getUserWishlist,
  addToWishlist,
  removeFromWishlist,
} from '../controllers/wishlistController.js';
import { verifyToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/', verifyToken, getUserWishlist);
router.post('/', verifyToken, addToWishlist);
router.delete('/:productId', verifyToken, removeFromWishlist);

export default router;
