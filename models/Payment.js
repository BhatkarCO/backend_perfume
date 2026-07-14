import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  order_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  razorpay_payment_id: { type: String, required: true, unique: true },
  amount: { type: Number, required: true },
  status: { type: String, required: true }, // e.g. 'captured', 'failed', 'refunded'
  method: { type: String }, // e.g. 'upi', 'card', 'digital'
  error_description: { type: String }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

// Map _id to id
paymentSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
paymentSchema.set('toJSON', { virtuals: true });
paymentSchema.set('toObject', { virtuals: true });

export default mongoose.model('Payment', paymentSchema);
