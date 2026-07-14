import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rating: { type: Number, required: true, min: 1, max: 5 },
  title: { type: String },
  comment: { type: String }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

// Indexes for fast lookup of product/user reviews
reviewSchema.index({ product_id: 1 });
reviewSchema.index({ user_id: 1 });

// Map _id to id
reviewSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
reviewSchema.set('toJSON', { virtuals: true });
reviewSchema.set('toObject', { virtuals: true });

export default mongoose.model('Review', reviewSchema);
