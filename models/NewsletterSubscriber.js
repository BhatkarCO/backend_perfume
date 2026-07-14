import mongoose from 'mongoose';

const newsletterSubscriberSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

// Map _id to id
newsletterSubscriberSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
newsletterSubscriberSchema.set('toJSON', { virtuals: true });
newsletterSubscriberSchema.set('toObject', { virtuals: true });

export default mongoose.model('NewsletterSubscriber', newsletterSubscriberSchema);