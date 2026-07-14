import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  quantity: { type: Number, required: true },
  price_at_purchase: { type: Number, required: true }
}, { _id: false }); // No _id for order items is fine, or default to yes. Usually false is clean.

const orderSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { 
    type: String, 
    default: 'Pending',
    enum: ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled']
  },
  total_amount: { type: Number, required: true },
  discount_amount: { type: Number, default: 0.00 },
  coupon_code: { type: String },
  shipping_address_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Address' },
  razorpay_order_id: { type: String },
  razorpay_payment_id: { type: String },
  items: [orderItemSchema]
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Indexes for fast lookup of customer order logs
orderSchema.index({ user_id: 1 });
orderSchema.index({ created_at: -1 });

// Map _id to id
orderSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
orderSchema.set('toJSON', { virtuals: true });
orderSchema.set('toObject', { virtuals: true });

export default mongoose.model('Order', orderSchema);
