import crypto from "crypto";
import PDFDocument from "pdfkit";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import Address from "../models/Address.js";
import Coupon from "../models/Coupon.js";
import Payment from "../models/Payment.js";
import User from "../models/User.js";
import InventoryLog from "../models/InventoryLog.js";
import razorpayInstance, { isMockMode } from "../config/razorpay.js";
import { sendEmail } from "../utils/email.js";
import { drawInvoicePDF } from "../utils/invoicePDF.js";
import { sendInvoiceEmail } from "../utils/resendEmail.js";

// Shipping logic: Free for order >= 1500, else 99
const calculateShipping = (subtotal) => {
  return subtotal >= 1500 ? 0.0 : 99.0;
};

/**
 * Validate Coupon
 */
export const validateCouponCode = async (code, subtotal) => {
  if (!code) return { valid: false, discount: 0 };

  const coupon = await Coupon.findOne({
    code: code.toUpperCase(),
    active: true,
    $or: [
      { expires_at: null },
      { expires_at: { $gt: new Date() } }
    ]
  });

  if (!coupon) {
    return { valid: false, message: "Invalid or expired coupon code." };
  }

  if (subtotal < parseFloat(coupon.min_purchase)) {
    return {
      valid: false,
      message: `Minimum purchase of ₹${coupon.min_purchase} required for this coupon.`,
    };
  }

  let discount = (subtotal * parseFloat(coupon.discount_percentage)) / 100;
  if (coupon.max_discount && discount > parseFloat(coupon.max_discount)) {
    discount = parseFloat(coupon.max_discount);
  }

  return { valid: true, discount, coupon };
};

/**
 * Endpoint to validate coupon
 */
export const applyCoupon = async (req, res) => {
  const { code, subtotal } = req.body;
  if (!code || subtotal === undefined) {
    return res
      .status(400)
      .json({ message: "Coupon code and subtotal are required." });
  }

  try {
    const result = await validateCouponCode(code, parseFloat(subtotal));
    if (!result.valid) {
      return res.status(400).json({ message: result.message });
    }

    res.status(200).json({
      message: "Coupon applied successfully.",
      discount: result.discount,
      code: result.coupon.code,
    });
  } catch (error) {
    console.error("Apply coupon error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * Create Order (Initiate checkout & Razorpay session)
 */
export const createOrder = async (req, res) => {
  const userId = req.user.id;
  const { items, shippingAddressId, couponCode } = req.body; // items: [{ productId, quantity }]

  if (!items || items.length === 0 || !shippingAddressId) {
    return res
      .status(400)
      .json({ message: "Items list and shipping address are required." });
  }

  try {
    // 1. Fetch address details
    const address = await Address.findOne({ _id: shippingAddressId, user_id: userId });
    if (!address) {
      return res.status(400).json({ message: "Invalid shipping address." });
    }

    // 2. Fetch products and calculate total cost in a single batch query
    const productIds = items.map(item => item.productId);
    const products = await Product.find({ _id: { $in: productIds } }).lean();

    const productMap = {};
    products.forEach(p => {
      productMap[p._id.toString()] = p;
    });

    let subtotal = 0;
    const itemsWithPrice = [];

    for (const item of items) {
      const product = productMap[item.productId];
      if (!product) {
        return res
          .status(404)
          .json({ message: `Product ID ${item.productId} not found.` });
      }

      if (product.stock_quantity < item.quantity) {
        return res
          .status(400)
          .json({
            message: `Insufficient stock for product ${product.name}. Available: ${product.stock_quantity}`,
          });
      }

      const activePrice = product.sale_price
        ? parseFloat(product.sale_price)
        : parseFloat(product.price);
      subtotal += activePrice * item.quantity;

      itemsWithPrice.push({
        product_id: product._id.toString(),
        name: product.name,
        quantity: item.quantity,
        price_at_purchase: activePrice,
      });
    }

    // 3. Apply coupon if valid
    let discount = 0;
    let validCouponCode = null;
    if (couponCode) {
      const couponResult = await validateCouponCode(couponCode, subtotal);
      if (couponResult.valid) {
        discount = couponResult.discount;
        validCouponCode = couponResult.coupon.code;
      }
    }

    const shipping = calculateShipping(subtotal - discount);
    const totalAmount = subtotal - discount + shipping;

    // 4. Create local order record in 'Pending' status
    const newOrder = new Order({
      user_id: userId,
      status: 'Pending',
      total_amount: totalAmount,
      discount_amount: discount,
      coupon_code: validCouponCode,
      shipping_address_id: shippingAddressId,
      items: itemsWithPrice.map(item => ({
        product_id: item.product_id,
        quantity: item.quantity,
        price_at_purchase: item.price_at_purchase
      }))
    });

    await newOrder.save();
    const localOrderId = newOrder.id;

    // 5. Integrate with Razorpay (Create Razorpay Order)
    let rzpOrder = null;
    let rzpOrderId = `mock_order_${localOrderId}_${Date.now()}`;

    if (!isMockMode()) {
      try {
        const options = {
          amount: Math.round(totalAmount * 100), // in paise
          currency: "INR",
          receipt: `receipt_order_${localOrderId}`,
        };
        rzpOrder = await razorpayInstance.orders.create(options);
        rzpOrderId = rzpOrder.id;
      } catch (rzpErr) {
        console.error(
          "Razorpay order creation failed, defaulting to mock credentials:",
          rzpErr,
        );
      }
    }

    // Update order with razorpay_order_id
    newOrder.razorpay_order_id = rzpOrderId;
    await newOrder.save();

    res.status(201).json({
      message: "Order checkout initiated.",
      orderId: localOrderId,
      razorpayOrderId: rzpOrderId,
      amount: totalAmount,
      shipping,
      discount,
      subtotal,
      currency: "INR",
      isMock: isMockMode(),
    });
  } catch (error) {
    console.error("Create order checkout error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * Verify Razorpay payment and confirm order
 */
export const verifyPayment = async (req, res) => {
  const userId = req.user.id;
  const { orderId, razorpayPaymentId, razorpayOrderId, razorpaySignature } =
    req.body;

  if (!orderId || !razorpayPaymentId || !razorpayOrderId) {
    return res
      .status(400)
      .json({ message: "Required payment parameters missing." });
  }

  try {
    // 1. Fetch local order
    const order = await Order.findOne({ _id: orderId, user_id: userId });
    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    if (order.status !== "Pending") {
      return res
        .status(400)
        .json({ message: "Order has already been processed." });
    }

    // 2. Signature verification
    let isPaymentValid = false;

    if (isMockMode() || razorpayOrderId.startsWith("mock_")) {
      // Mock payment mode skips cryptographic check
      isPaymentValid = true;
    } else {
      const keySecret = process.env.RAZORPAY_KEY_SECRET;
      const expectedSignature = crypto
        .createHmac("sha256", keySecret)
        .update(razorpayOrderId + "|" + razorpayPaymentId)
        .digest("hex");

      isPaymentValid = expectedSignature === razorpaySignature;
    }

    if (!isPaymentValid) {
      return res
        .status(400)
        .json({ message: "Payment signature verification failed." });
    }

    // 3. Confirm order & register payment in database
    order.status = 'Confirmed';
    order.razorpay_payment_id = razorpayPaymentId;
    await order.save();

    const payment = new Payment({
      order_id: orderId,
      razorpay_payment_id: razorpayPaymentId,
      amount: order.total_amount,
      status: 'captured',
      method: 'digital'
    });
    await payment.save();

    // 4. Update inventory and log stock removal
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.product_id, {
        $inc: { stock_quantity: -item.quantity }
      });

      const log = new InventoryLog({
        product_id: item.product_id,
        change_amount: -item.quantity,
        reason: `Purchase - Order #${orderId}`
      });
      await log.save();
    }

    // 5. Send order confirmation email
    const customer = await User.findById(userId);
    if (customer) {
      try {
        await sendEmail({
          to: customer.email,
          subject: `Order Confirmed! - Bhatkar Perfumes Order #${orderId}`,
          text: `Hello ${customer.name}, your order #${orderId} of ₹${order.total_amount} has been successfully placed and confirmed. Thank you for shopping with Bhatkar Perfumes!`,
          html: `
            <div style="font-family: Arial, sans-serif; background-color: #FAF9F6; color: #1F1F1F; padding: 30px; border-radius: 4px; max-width: 600px; margin: 0 auto; border: 1px solid #E4E4E0;">
              <h2 style="color: #B89765; text-align: center; font-family: 'Playfair Display', Georgia, serif;">Order Confirmed!</h2>
              <p>Hello ${customer.name},</p>
              <p>We are delighted to let you know that your payment was successful and your order has been confirmed.</p>
              <hr style="border: 0; border-top: 1px solid #E4E4E0; margin: 20px 0;">
              <h3 style="color: #B89765; font-family: 'Playfair Display', Georgia, serif;">Order Summary</h3>
              <p><strong>Order ID:</strong> #${orderId}</p>
              <p><strong>Total Amount Paid:</strong> ₹${order.total_amount}</p>
              <p><strong>Payment ID:</strong> ${razorpayPaymentId}</p>
              <p>We are preparing your luxurious fragrance selection. You can track your order status directly on your dashboard.</p>
              <p style="text-align: center; margin-top: 30px;">
                <a href="${process.env.FRONTEND_URL || "http://localhost:3000"}/dashboard" style="background-color: #1F1F1F; color: #FFFFFF; padding: 12px 25px; text-decoration: none; font-weight: bold; border-radius: 4px;">Go to Dashboard</a>
              </p>
            </div>
          `,
        });
      } catch (err) {
        console.error("Nodemailer confirmation email failed:", err);
      }
    }

    // 6. Send invoice via Resend
    try {
      const populatedOrder = await Order.findById(orderId)
        .populate('user_id')
        .populate('shipping_address_id')
        .populate('items.product_id');

      const fullOrder = {
        ...populatedOrder.toObject(),
        customer_name: populatedOrder.user_id?.name,
        customer_email: populatedOrder.user_id?.email,
        address_line1: populatedOrder.shipping_address_id?.address_line1,
        address_line2: populatedOrder.shipping_address_id?.address_line2,
        city: populatedOrder.shipping_address_id?.city,
        state: populatedOrder.shipping_address_id?.state,
        postal_code: populatedOrder.shipping_address_id?.postal_code,
        shipping_phone: populatedOrder.shipping_address_id?.phone,
        country: populatedOrder.shipping_address_id?.country
      };

      const fullItems = populatedOrder.items.map(item => ({
        quantity: item.quantity,
        price_at_purchase: item.price_at_purchase,
        name: item.product_id?.name
      }));

      await sendInvoiceEmail(fullOrder, fullItems);
    } catch (emailErr) {
      console.error("Resend invoice email delivery failed:", emailErr);
    }

    res.status(200).json({
      message: "Payment verified and order confirmed.",
      orderId,
    });
  } catch (error) {
    console.error("Verify payment error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * Get all orders for the logged-in customer
 */
export const getUserOrders = async (req, res) => {
  const userId = req.user.id;

  try {
    const orders = await Order.find({ user_id: userId }).sort({ created_at: -1 }).lean();

    const formattedOrders = orders.map(o => ({
      ...o,
      id: o._id.toString(),
      total_items: o.items.length
    }));

    res.status(200).json(formattedOrders);
  } catch (error) {
    console.error("Fetch user orders error:", error);
    res.status(500).json({ message: "Error retrieving orders." });
  }
};

/**
 * Get single order details
 */
export const getOrderById = async (req, res) => {
  const userId = req.user.id;
  const { orderId } = req.params;

  try {
    const order = await Order.findOne({ _id: orderId, user_id: userId })
      .populate('shipping_address_id')
      .populate('items.product_id');

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    const oObj = order.toObject();
    
    // Format flat shipping address properties for backward compatibility
    oObj.address_line1 = order.shipping_address_id?.address_line1;
    oObj.address_line2 = order.shipping_address_id?.address_line2;
    oObj.city = order.shipping_address_id?.city;
    oObj.state = order.shipping_address_id?.state;
    oObj.postal_code = order.shipping_address_id?.postal_code;
    oObj.shipping_phone = order.shipping_address_id?.phone;
    oObj.country = order.shipping_address_id?.country;

    // Format items to expected structure
    oObj.items = order.items.map(item => {
      const prod = item.product_id;
      const primaryImage = prod?.images?.find(img => img.is_primary)?.image_url 
        || (prod?.images?.[0]?.image_url || null);
      
      return {
        product_id: prod?._id,
        name: prod?.name,
        slug: prod?.slug,
        quantity: item.quantity,
        price_at_purchase: item.price_at_purchase,
        primary_image: primaryImage
      };
    });

    res.status(200).json(oObj);
  } catch (error) {
    console.error("Fetch single order details error:", error);
    res.status(500).json({ message: "Error retrieving order details." });
  }
};

/**
 * Download invoice PDF for order
 */
export const downloadInvoice = async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    const orderObj = await Order.findById(orderId)
      .populate('user_id')
      .populate('shipping_address_id')
      .populate('items.product_id');

    if (!orderObj) {
      return res.status(404).json({ message: "Order or invoice not found." });
    }

    if (userRole !== "admin" && orderObj.user_id?._id.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Unauthorized action." });
    }

    const order = {
      ...orderObj.toObject(),
      customer_name: orderObj.user_id?.name,
      customer_email: orderObj.user_id?.email,
      address_line1: orderObj.shipping_address_id?.address_line1,
      address_line2: orderObj.shipping_address_id?.address_line2,
      city: orderObj.shipping_address_id?.city,
      state: orderObj.shipping_address_id?.state,
      postal_code: orderObj.shipping_address_id?.postal_code,
      shipping_phone: orderObj.shipping_address_id?.phone,
      country: orderObj.shipping_address_id?.country
    };

    const items = orderObj.items.map(item => ({
      quantity: item.quantity,
      price_at_purchase: item.price_at_purchase,
      name: item.product_id?.name
    }));

    // Generate PDF using PDFKit
    const doc = new PDFDocument({ margin: 50 });

    // HTTP Headers for PDF streaming
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Invoice_Bhatkar_${orderId}.pdf`,
    );
    doc.pipe(res);

    drawInvoicePDF(doc, order, items);
  } catch (error) {
    console.error("Invoice PDF generation error:", error);
    res.status(500).json({ message: "Error generating invoice." });
  }
};
