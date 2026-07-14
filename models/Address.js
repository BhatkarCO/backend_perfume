import mongoose from 'mongoose';

const addressSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  address_line1: { type: String, required: true },
  address_line2: { type: String },
  city: { type: String, required: true },
  state: { type: String, required: true },
  postal_code: { type: String, required: true },
  country: { type: String, default: 'India' },
  phone: { type: String, required: true },
  is_default: { type: Boolean, default: false }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

// Index for fast lookup of user addresses
addressSchema.index({ user_id: 1 });

// Map _id to id
addressSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
addressSchema.set('toJSON', { virtuals: true });
addressSchema.set('toObject', { virtuals: true });

export default mongoose.model('Address', addressSchema);
