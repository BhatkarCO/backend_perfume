import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  slug: { type: String, required: true, unique: true },
  description: { type: String },
  image_url: { type: String }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

// Map _id to id
categorySchema.virtual('id').get(function() {
  return this._id.toHexString();
});
categorySchema.set('toJSON', { virtuals: true });
categorySchema.set('toObject', { virtuals: true });

export default mongoose.model('Category', categorySchema);
