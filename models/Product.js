import mongoose from 'mongoose';

const productImageSchema = new mongoose.Schema({
  image_url: { type: String, required: true },
  is_primary: { type: Boolean, default: false }
});

productImageSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
productImageSchema.set('toJSON', { virtuals: true });
productImageSchema.set('toObject', { virtuals: true });

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  description: { type: String, required: true },
  short_description: { type: String },
  price: { type: Number, required: true },
  sale_price: { type: Number },
  stock_quantity: { type: Number, default: 0 },
  category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  gender: { type: String, enum: ['Men', 'Women', 'Unisex'] },
  rating: { type: Number, default: 0.00 },
  is_featured: { type: Boolean, default: false },
  is_best_selling: { type: Boolean, default: false },
  is_new_arrival: { type: Boolean, default: false },
  fragrance_notes: {
    top: [String],
    heart: [String],
    base: [String]
  },
  video_url: { type: String },
  images: [productImageSchema]
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Indexes for optimized searching, filtering, and sorting
productSchema.index({ category_id: 1 });
productSchema.index({ gender: 1 });
productSchema.index({ rating: -1 });
productSchema.index({ is_best_selling: 1 });
productSchema.index({ created_at: -1 });

// Map _id to id
productSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

export default mongoose.model('Product', productSchema);
