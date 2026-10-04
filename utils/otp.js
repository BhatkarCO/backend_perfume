import crypto from "crypto";

export const generateOTP = () => {
  if (
    process.env.NODE_ENV === "development" &&
    process.env.OTP_DEV_FALLBACK === "true"
  ) {
    return "000000";
  }

  return crypto.randomInt(100000, 999999).toString();
};