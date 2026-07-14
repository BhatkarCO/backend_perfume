import Razorpay from 'razorpay';
import dotenv from 'dotenv';

dotenv.config();

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;

const isRazorpayConfigured = keyId && keySecret;

let razorpayInstance = null;

if (isRazorpayConfigured) {
  try {
    razorpayInstance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
    console.log('Razorpay initialized successfully.');
  } catch (error) {
    console.error('Error initializing Razorpay:', error);
  }
} else {
  console.warn('Razorpay credentials missing. Running in MOCK checkout mode.');
}

export const getRazorpayInstance = () => razorpayInstance;
export const isMockMode = () => !isRazorpayConfigured;
export default razorpayInstance;
