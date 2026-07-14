import mongoose from 'mongoose';

const contactMessageSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, lowercase: true },
  subject: { type: String },
  message: { type: String, required: true }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

// Map _id to id
contactMessageSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
contactMessageSchema.set('toJSON', { virtuals: true });
contactMessageSchema.set('toObject', { virtuals: true });

export default mongoose.model('ContactMessage', contactMessageSchema);
