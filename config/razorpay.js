import Razorpay from "razorpay";
import dotenv from "dotenv";

dotenv.config();

const runtimeEnvironment = process.env.NODE_ENV;
const mockFlag = process.env.PAYMENT_MOCK_MODE;

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;

// Razorpay's maximum Orders API capture window is three days.
export const MANUAL_CAPTURE_WINDOW_MS = 72 * 60 * 60 * 1000;

export const isManualCapturePolicyEnabled = () =>
  !mockMode &&
  process.env.RAZORPAY_CAPTURE_MODE === "manual" &&
  process.env.RAZORPAY_CAPTURE_TIMEOUT_HOURS === "72" &&
  process.env.RAZORPAY_DIRECT_SETTLEMENT === "false";

if (mockFlag !== undefined && !["true", "false"].includes(mockFlag)) {
  throw new Error("PAYMENT_MOCK_MODE must be explicitly true or false.");
}

const mockMode =
  mockFlag === "true" &&
  ["development", "test"].includes(runtimeEnvironment);

if (mockFlag === "true" && !mockMode) {
  throw new Error(
    "Mock payments are allowed only in explicit development or test environments.",
  );
}

if (!mockMode && (!keyId || !keySecret)) {
  throw new Error(
    "Razorpay credentials are required when mock payments are disabled.",
  );
}

let razorpayInstance = null;

if (!mockMode) {
  try {
    razorpayInstance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    console.log("Razorpay initialized successfully.");
  } catch (error) {
    console.error("Error initializing Razorpay:", error);
    throw error;
  }
} else {
  console.warn(
    "Razorpay MOCK mode enabled for development.",
  );
}

export const getRazorpayInstance = () => razorpayInstance;

export const isMockMode = () => mockMode;

export default razorpayInstance;