import mongoose from 'mongoose';

const inventoryLogSchema = new mongoose.Schema({
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  change_amount: { type: Number, required: true },
  reason: { type: String }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

// Map _id to id
inventoryLogSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
inventoryLogSchema.set('toJSON', { virtuals: true });
inventoryLogSchema.set('toObject', { virtuals: true });

export default mongoose.model('InventoryLog', inventoryLogSchema);
