import express from 'express';
import { z } from 'zod';
import { subscribeNewsletter, submitContactForm } from '../controllers/contactController.js';
import { contactLimiter, newsletterLimiter } from '../middleware/authRateLimiters.js';
import { validate } from '../middleware/validate.js';

const router = express.Router();

const newsletterSchema = z
  .object({
    email: z.string().trim().max(254).email(),
  })
  .strict();

export const contactSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[^\u0000-\u001F\u007F]+$/),
    email: z.string().trim().max(254).email(),
    subject: z
      .string()
      .trim()
      .max(150)
      .regex(/^[^\u0000-\u001F\u007F]*$/)
      .optional(),
    message: z.string().trim().min(1).max(5000),
  })
  .strict();

router.post(
  '/newsletter',
  newsletterLimiter,
  validate(newsletterSchema),
  subscribeNewsletter,
);
router.post('/contact', contactLimiter, validate(contactSchema), submitContactForm);

export default router;
