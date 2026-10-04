import mongoose from "mongoose";

const otpSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true },
    otp: { type: String, required: true }, // Hashed OTP
    purpose: {
      type: String,
      enum: [
        "register",
        "forgot-password",
        "admin-forgot-password",
        "delete-account",
      ],
      required: true,
    },
    userData: { type: mongoose.Schema.Types.Mixed }, // Contains { name, password (hashed), phone }
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    expiresAt: { type: Date, required: true },
    verified: { type: Boolean, default: false },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: Date.now },
    resetAuthorizationHash: { type: String },
    resetAuthorizationExpiresAt: { type: Date },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

// TTL index to automatically delete expired documents
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpSchema.index({ email: 1, purpose: 1 }, { unique: true });

export default mongoose.model("OTP", otpSchema);
