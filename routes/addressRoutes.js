import express from 'express';
import {
  getAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
} from '../controllers/addressController.js';
import { verifyToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/', verifyToken, getAddresses);
router.post('/', verifyToken, addAddress);
router.put('/:id', verifyToken, updateAddress);
router.delete('/:id', verifyToken, deleteAddress);

export default router;
