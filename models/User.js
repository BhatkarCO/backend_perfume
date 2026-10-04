import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    // Optional because Google users don't have a local password
    password_hash: {
      type: String,
      required: false,
    },

    // Google account identifier
    google_id: {
      type: String,
      unique: true,
      sparse: true,
    },

    // How the user authenticated
    auth_provider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },

    role: {
      type: String,
      enum: ["user", "admin", "blocked"],
      default: "user",
    },

    session_version: {
      type: Number,
      default: 0,
    },

    admin_reset_attempts: {
      type: Number,
      select: false,
    },

    admin_reset_attempts_reset_at: {
      type: Date,
      select: false,
    },

    name: {
      type: String,
      required: true,
    },

    phone: {
      type: String,
    },

    otp_code: {
      type: String,
    },

    otp_expires_at: {
      type: Date,
    },

    is_verified: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
);

// Map _id to id
userSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

userSchema.set("toJSON", { virtuals: true });
userSchema.set("toObject", { virtuals: true });

export default mongoose.model("User", userSchema);
