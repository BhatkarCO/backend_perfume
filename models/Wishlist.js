import mongoose from 'mongoose';

const wishlistSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

// Compound index to guarantee uniqueness of user_id + product_id
wishlistSchema.index({ user_id: 1, product_id: 1 }, { unique: true });

// Map _id to id
wishlistSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
wishlistSchema.set('toJSON', { virtuals: true });
wishlistSchema.set('toObject', { virtuals: true });

export default mongoose.model('Wishlist', wishlistSchema);
