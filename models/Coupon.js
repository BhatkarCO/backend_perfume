import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true },
  discount_percentage: { type: Number, required: true },
  max_discount: { type: Number },
  min_purchase: { type: Number, default: 0.00 },
  active: { type: Boolean, default: true },
  expires_at: { type: Date }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

// Map _id to id
couponSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
couponSchema.set('toJSON', { virtuals: true });
couponSchema.set('toObject', { virtuals: true });

export default mongoose.model('Coupon', couponSchema);
