import express from 'express';
import { subscribeNewsletter, submitContactForm } from '../controllers/contactController.js';

const router = express.Router();

router.post('/newsletter', subscribeNewsletter);
router.post('/contact', submitContactForm);

export default router;
