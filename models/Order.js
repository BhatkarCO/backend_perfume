import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema(
  {
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    quantity: { type: Number, required: true },
    price_at_purchase: { type: Number, required: true },
  },
  { _id: false },
); // No _id for order items is fine, or default to yes. Usually false is clean.

const orderSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: {
      type: String,
      default: "Pending",
      enum: [
        "Pending",
        "Confirmed",
        "Processing",
        "Shipped",
        "Delivered",
        "Cancelled",
      ],
    },
    payment_method: {
      type: String,
      enum: ["COD", "RAZORPAY", "STRIPE", "PAYPAL"],
      default: "RAZORPAY",
    },

    payment_status: {
      type: String,
      enum: ["Pending", "Paid", "Failed"],
      default: "Pending",
    },
    total_amount: { type: Number, required: true },

    pricing: {
      product_price: Number,
      delivery_charge: Number,
      gst_percentage: Number,
      gst_amount: Number,
      subtotal: Number,
      total: Number,
      discount: Number,
      payable: Number,
    },

    discount_amount: { type: Number, default: 0.0 },
    coupon_code: { type: String },
    shipping_address_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Address",
    },
    courier: {
      courier_company_id: Number,
      courier_name: String,
      estimated_delivery_days: Number,
    },
    shiprocket_order_id: { type: String },
    shiprocket_shipment_id: { type: Number },
    shiprocket_awb: { type: String },
    shiprocket_courier_name: { type: String },
    shiprocket_status: {
      type: String,
      enum: [
        "Created",
        "AWB_ASSIGNED",
        "PICKUP_SCHEDULED",
        "PICKED_UP",
        "IN_TRANSIT",
        "OUT_FOR_DELIVERY",
        "DELIVERED",
        "CANCELLED",
        "RTO",
        "RTO_DELIVERED",
        "LOST",
        "Failed",
      ],
      default: "Created",
    },
    razorpay_order_id: { type: String },
    razorpay_payment_id: { type: String },
    items: [orderItemSchema],
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

// Indexes for fast lookup of customer order logs
orderSchema.index({ user_id: 1 });
orderSchema.index({ created_at: -1 });

// Map _id to id
orderSchema.virtual("id").get(function () {
  return this._id.toHexString();
});
orderSchema.set("toJSON", { virtuals: true });
orderSchema.set("toObject", { virtuals: true });

export default mongoose.model("Order", orderSchema);
