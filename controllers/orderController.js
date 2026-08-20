import crypto from "crypto";
import PDFDocument from "pdfkit";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import Address from "../models/Address.js";
import Coupon from "../models/Coupon.js";
import { calculateGST, calculateFinalAmount } from "../utils/pricing.js";
import { GST_PERCENTAGE } from "../config/pricing.js";
import {
  checkServiceability,
  createShiprocketOrder,
  assignShiprocketAwb,
  generateShiprocketPickup,
  getShiprocketTracking,
  generateShiprocketInvoice,
  SHIPROCKET_CONFIG,
} from "../config/shiprocket.js";
import Payment from "../models/Payment.js";
import User from "../models/User.js";
import InventoryLog from "../models/InventoryLog.js";
import razorpayInstance, { isMockMode } from "../config/razorpay.js";
import { sendEmail } from "../utils/email.js";
import { drawInvoicePDF } from "../utils/invoicePDF.js";
import { sendInvoiceEmail } from "../utils/resendEmail.js";

/**
 * Validate Coupon
 */
export const validateCouponCode = async (code, subtotal) => {
  if (!code) return { valid: false, discount: 0 };

  const coupon = await Coupon.findOne({
    code: code.toUpperCase(),
    active: true,
    $or: [{ expires_at: null }, { expires_at: { $gt: new Date() } }],
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

const formatShiprocketAddressLine = (address) => {
  return `${address.address_line1}${address.address_line2 ? `, ${address.address_line2}` : ""}`;
};

const buildShiprocketOrderPayload = ({
  localOrderId,
  user,
  address,
  items,
  subtotal,
  shippingCharge,
  paymentMethod,
}) => {
  const orderDate = new Date().toISOString().slice(0, 19).replace("T", " ");
  console.log("========== BUILD PAYLOAD ITEMS ==========");
  console.log(JSON.stringify(items, null, 2));
  return {
    order_id: localOrderId,
    order_date: orderDate,
    pickup_location: SHIPROCKET_CONFIG.pickupLocation,
    billing_customer_name: user.name || "Customer",
    billing_last_name: "",
    billing_address: formatShiprocketAddressLine(address),
    billing_city: address.city,
    billing_pincode: address.postal_code,
    billing_state: address.state,
    billing_country: address.country || "India",
    billing_email: user.email,
    billing_phone: address.phone,
    shipping_is_billing: true,
    shipping_customer_name: user.name || "Customer",
    shipping_address: formatShiprocketAddressLine(address),
    shipping_city: address.city,
    shipping_pincode: address.postal_code,
    shipping_state: address.state,
    shipping_country: address.country || "India",
    shipping_email: user.email,
    shipping_phone: address.phone,
    order_items: items.map((item) => {
      console.log("Shiprocket item:", item);

      const doc = item._doc || item;

      const quantity = Number(doc.quantity) || 0;
      const basePrice = Number(doc.price_at_purchase) || 0;

      // Your website price is GST-exclusive.
      const gstPerUnit = calculateGST(basePrice);

      // Shiprocket requires selling_price to be GST-inclusive.
      const sellingPriceInclusive = Number((basePrice + gstPerUnit).toFixed(2));

      return {
        name: item.name || "Product",

        sku: String(doc.product_id),

        units: quantity,

        selling_price: sellingPriceInclusive,

        discount: 0,

        // Shiprocket expects TAX PERCENTAGE here, not tax amount.
        tax: GST_PERCENTAGE,

        hsn: "3304",

        brand: "Bhatkar Perfumes",
      };
    }),
    payment_method: paymentMethod === "COD" ? "COD" : "Prepaid",
    sub_total: Number((subtotal + calculateGST(subtotal)).toFixed(2)),
    shipping_charges: shippingCharge,
    length: SHIPROCKET_CONFIG.defaultDimensions.length,
    breadth: SHIPROCKET_CONFIG.defaultDimensions.breadth,
    height: SHIPROCKET_CONFIG.defaultDimensions.height,
    weight: Number(
      Math.max(
        SHIPROCKET_CONFIG.defaultWeight || 0.5,
        items.reduce(
          (sum, item) =>
            sum +
            Number(item.quantity || 1) *
              Number(SHIPROCKET_CONFIG.defaultWeight || 0.5),
          0,
        ),
      ),
    ),
    delivery_postcode: address.postal_code,
  };
};

const registerShiprocketShipment = async ({
  order,
  user,
  address,
  items,
  subtotal,
  shippingCharge,
  paymentMethod,
}) => {
  if (order.shiprocket_shipment_id) {
    console.warn(
      "Shiprocket registration skipped because order already has shiprocket_shipment_id:",
      order.shiprocket_shipment_id,
    );
    return order;
  }

  try {
    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        if (item.name) return item;

        if (!item.product_id) {
          return item;
        }

        const product = await Product.findById(item.product_id).lean();
        return {
          ...item,
          name: product?.name || `Product ${item.product_id}`,
        };
      }),
    );
    const normalizedItems = enrichedItems.map((item) =>
      item.toObject ? item.toObject() : item,
    );
    console.log("========== ENRICHED ITEMS ==========");
    console.log(JSON.stringify(enrichedItems, null, 2));

    const payload = buildShiprocketOrderPayload({
      localOrderId: order.id,
      user,
      address,
      items: normalizedItems,
      subtotal,
      shippingCharge,
      paymentMethod,
    });

    let createResponse;
    try {
      console.log("========== FINAL SHIPROCKET PAYLOAD ==========");
      console.log(JSON.stringify(payload, null, 2));
      createResponse = await createShiprocketOrder(payload);
      console.log("========== SHIPROCKET CREATE RESPONSE ==========");
      console.log(JSON.stringify(createResponse, null, 2));
    } catch (error) {
      const errorData = error.response?.data || error.data || null;
      const candidateLocations =
        errorData?.data || errorData?.data?.data || null;
      const fallbackPickupLocation = Array.isArray(candidateLocations)
        ? candidateLocations[0]?.pickup_location
        : null;

      if (
        errorData?.message?.includes("Wrong Pickup location entered") &&
        fallbackPickupLocation
      ) {
        console.warn(
          "Shiprocket pickup location invalid, retrying with:",
          fallbackPickupLocation,
        );
        payload.pickup_location = fallbackPickupLocation;
        createResponse = await createShiprocketOrder(payload);
        console.log("========== SHIPROCKET RETRY RESPONSE ==========");
        console.log(JSON.stringify(createResponse, null, 2));
      } else {
        throw error;
      }
    }

    const shipmentId =
      createResponse.shipment_id || createResponse.data?.shipment_id;
    const shiprocketOrderId =
      createResponse.order_id ||
      createResponse.data?.order_id ||
      createResponse.data?.order_id;

    if (!shipmentId) {
      // Log payload and full response for debugging when Shiprocket doesn't return shipment_id
      try {
        console.error(
          "Shiprocket create order payload:",
          JSON.stringify(payload, null, 2),
        );
      } catch (e) {
        console.error("Shiprocket create order payload (stringify failed)", e);
      }
      try {
        console.error(
          "Shiprocket create response:",
          JSON.stringify(createResponse, null, 2),
        );
      } catch (e) {
        console.error(
          "Shiprocket create response (stringify failed)",
          createResponse,
        );
      }

      throw new Error("Shiprocket did not return a shipment_id.");
    }

    order.shiprocket_order_id = shiprocketOrderId;
    order.shiprocket_shipment_id = shipmentId;
    order.shiprocket_status = "Created";
    await order.save();

    const assignRequest = {
      shipment_id: shipmentId,
    };

    if (order.courier?.courier_company_id) {
      assignRequest.courier_id = order.courier.courier_company_id;
    }
    console.debug("Shiprocket assign AWB request:", assignRequest);

    const assignResponse = await assignShiprocketAwb(assignRequest);

    console.log("========== SHIPROCKET ASSIGN AWB RESPONSE ==========");
    console.log(JSON.stringify(assignResponse, null, 2));

    // Shiprocket response structure:
    // assignResponse.response.data.awb_code

    const shiprocketData =
      assignResponse?.response?.data ||
      assignResponse?.data?.response?.data ||
      assignResponse?.data ||
      assignResponse;

    const awbCode =
      shiprocketData?.awb_code || shiprocketData?.awb_number || null;

    const courierName =
      shiprocketData?.courier_name || order.courier?.courier_name || null;

    const courierCompanyId =
      shiprocketData?.courier_company_id ||
      order.courier?.courier_company_id ||
      null;

    const assignedShipmentId = shiprocketData?.shipment_id || shipmentId;

    if (!awbCode) {
      console.error("========== SHIPROCKET AWB ASSIGN FAILED ==========");

      console.error(JSON.stringify(assignResponse, null, 2));

      // Use a status that your existing schema already accepts
      order.shiprocket_status = "Failed";

      await order.save();

      throw new Error("AWB not Assigned");
    }

    console.log("========== AWB ASSIGNED SUCCESSFULLY ==========");
    console.log("AWB:", awbCode);
    console.log("Courier:", courierName);
    console.log("Courier Company ID:", courierCompanyId);
    console.log("Shipment ID:", assignedShipmentId);

    // Save Shiprocket details
    order.shiprocket_awb = String(awbCode);
    order.shiprocket_courier_name = courierName;
    order.shiprocket_shipment_id = assignedShipmentId;

    // Keep this as AWB_ASSIGNED until webhook updates the
    // actual Shiprocket shipment status.
    order.shiprocket_status = "AWB_ASSIGNED";

    await order.save();

    console.log("========== SHIPROCKET DETAILS SAVED ==========");
    console.log({
      shiprocket_order_id: order.shiprocket_order_id,
      shiprocket_shipment_id: order.shiprocket_shipment_id,
      shiprocket_awb: order.shiprocket_awb,
      shiprocket_courier_name: order.shiprocket_courier_name,
      shiprocket_status: order.shiprocket_status,
    });

    return order;
  } catch (error) {
    console.error("========== SHIPROCKET ERROR ==========");
    console.error("Status:", error.response?.status);
    console.error("Headers:", error.response?.headers);
    console.error("Response:", JSON.stringify(error.response?.data, null, 2));
    console.error("Message:", error.message);

    if (error.response?.config?.url) {
      console.error("URL:", error.response.config.url);
    }

    return order;
  }
};

/**
 * Preview Order Pricing
 * Calculates subtotal, coupon, GST & Shiprocket delivery charges
 * WITHOUT creating an order.
 */
export const previewOrder = async (req, res) => {
  const userId = req.user.id;

  const {
    items,
    shippingAddressId,
    couponCode,
    paymentMethod = "RAZORPAY",
  } = req.body;

  if (!items || items.length === 0 || !shippingAddressId) {
    return res.status(400).json({
      message: "Items list and shipping address are required.",
    });
  }

  try {
    // -----------------------------------
    // Validate Address
    // -----------------------------------
    const address = await Address.findOne({
      _id: shippingAddressId,
      user_id: userId,
    });

    if (!address) {
      return res.status(400).json({
        message: "Invalid shipping address.",
      });
    }

    // -----------------------------------
    // Fetch Products
    // -----------------------------------
    const productIds = items.map((item) => item.productId);

    const products = await Product.find({
      _id: { $in: productIds },
    }).lean();

    const productMap = {};

    products.forEach((product) => {
      productMap[product._id.toString()] = product;
    });

    let subtotal = 0;

    const itemsWithPrice = [];

    for (const item of items) {
      const product = productMap[item.productId];

      if (!product) {
        return res.status(404).json({
          message: `Product not found.`,
        });
      }

      if (product.stock_quantity < item.quantity) {
        return res.status(400).json({
          message: `${product.name} is out of stock.`,
        });
      }

      const activePrice = product.sale_price
        ? Number(product.sale_price)
        : Number(product.price);

      subtotal += activePrice * item.quantity;

      itemsWithPrice.push({
        product,
        quantity: item.quantity,
        price: activePrice,
      });
    }

    // -----------------------------------
    // Coupon
    // -----------------------------------
    let discount = 0;

    if (couponCode) {
      const coupon = await validateCouponCode(couponCode, subtotal);

      if (coupon.valid) {
        discount = coupon.discount;
      }
    }

    // -----------------------------------
    // Shiprocket Serviceability
    // -----------------------------------

    const serviceability = await checkServiceability({
      pickupPostcode: SHIPROCKET_CONFIG.pickupPostcode,
      deliveryPostcode: address.postal_code,
      cod: paymentMethod === "COD" ? 1 : 0,
      weight: SHIPROCKET_CONFIG.defaultWeight,
    });
    console.log("========== SHIPROCKET RESPONSE ==========");
    console.log(JSON.stringify(serviceability, null, 2));
    console.log("=========================================");

    console.log("success:", serviceability.success);
    console.log("data:", serviceability.data);

    if (
      serviceability.status !== 200 ||
      !Array.isArray(serviceability.data?.available_courier_companies)
    ) {
      return res.status(400).json({
        message: "Delivery not available.",
      });
    }

    const available_courier_companies =
      serviceability.data.available_courier_companies;

    const shiprocket_recommended_courier_id =
      serviceability.data.shiprocket_recommended_courier_id;

    let recommendedCourier = available_courier_companies.find(
      (courier) =>
        courier.courier_company_id === shiprocket_recommended_courier_id,
    );

    // Fallback

    if (!recommendedCourier) {
      recommendedCourier = available_courier_companies[0];
    }

    if (!recommendedCourier) {
      return res.status(400).json({
        message: "No courier available for this address.",
      });
    }

    const shippingCharge = Number(recommendedCourier.freight_charge);

    // -----------------------------------
    // Pricing
    // -----------------------------------

    const pricing = calculateFinalAmount({
      productPrice: subtotal,
      shippingCharge,
      discount,
    });

    return res.status(200).json({
      success: true,

      pricing,

      courier: {
        courier_company_id: recommendedCourier.courier_company_id,

        courier_name: recommendedCourier.courier_name,

        estimated_delivery_days: recommendedCourier.estimated_delivery_days,
      },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Unable to preview order pricing.",
    });
  }
};

/**
 * Create Order (Initiate checkout & Razorpay session)
 */
export const createOrder = async (req, res) => {
  const userId = req.user.id;
  const { items, shippingAddressId, couponCode, paymentMethod } = req.body; // items: [{ productId, quantity }]

  if (!items || items.length === 0 || !shippingAddressId) {
    return res
      .status(400)
      .json({ message: "Items list and shipping address are required." });
  }

  try {
    // 1. Fetch address details
    const address = await Address.findOne({
      _id: shippingAddressId,
      user_id: userId,
    });
    if (!address) {
      return res.status(400).json({ message: "Invalid shipping address." });
    }
    // -----------------------------
    // Get Shipping Charge
    // -----------------------------

    const serviceability = await checkServiceability({
      pickupPostcode: SHIPROCKET_CONFIG.pickupPostcode,
      deliveryPostcode: address.postal_code,
      cod: paymentMethod === "COD" ? 1 : 0,
      weight: SHIPROCKET_CONFIG.defaultWeight,
    });
    console.log(JSON.stringify(serviceability, null, 2));

    // -----------------------------
    // Get Recommended Courier
    // -----------------------------

    const { available_courier_companies, shiprocket_recommended_courier_id } =
      serviceability.data;

    let recommendedCourier = available_courier_companies.find(
      (courier) =>
        courier.courier_company_id === shiprocket_recommended_courier_id,
    );

    if (!recommendedCourier && available_courier_companies.length > 0) {
      recommendedCourier = available_courier_companies[0];
    }

    if (!recommendedCourier) {
      return res.status(400).json({
        message: "No courier available.",
      });
    }

    const shippingCharge = Number(recommendedCourier.freight_charge);

    // 2. Fetch products and calculate total cost in a single batch query
    const productIds = items.map((item) => item.productId);
    const products = await Product.find({ _id: { $in: productIds } }).lean();

    const productMap = {};
    products.forEach((p) => {
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
        return res.status(400).json({
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

    const pricing = calculateFinalAmount({
      productPrice: subtotal,
      shippingCharge,
      discount,
    });

    const totalAmount = pricing.payable;

    // 4. Create local order record in 'Pending' status
    const newOrder = new Order({
      user_id: userId,

      status: "Pending",

      payment_method: paymentMethod,
      payment_status: "Pending",

      total_amount: totalAmount,

      pricing,

      discount_amount: discount,

      coupon_code: validCouponCode,

      courier: {
        courier_company_id: recommendedCourier.courier_company_id,
        courier_name: recommendedCourier.courier_name,
        estimated_delivery_days: recommendedCourier.estimated_delivery_days,
      },

      shipping_address_id: shippingAddressId,

      items: itemsWithPrice.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        price_at_purchase: item.price_at_purchase,
      })),
    });

    await newOrder.save();
    const localOrderId = newOrder.id;

    // ===========================
    // CASH ON DELIVERY FLOW
    // ===========================
    if (paymentMethod === "COD") {
      newOrder.status = "Pending";
      newOrder.payment_status = "Pending";
      await newOrder.save();

      try {
        const customer = await User.findById(userId);
        if (customer) {
          await registerShiprocketShipment({
            order: newOrder,
            user: customer,
            address,
            items: itemsWithPrice,
            subtotal,
            shippingCharge,
            paymentMethod,
          });
        }
      } catch (shipErr) {
        console.error("COD Shiprocket registration failed:", shipErr);
      }

      return res.status(201).json({
        success: true,
        paymentMethod: "COD",
        orderId: localOrderId,
        amount: totalAmount,
        pricing,
        shippingCharge,
        discount,
        subtotal,
        currency: "INR",
        isMock: isMockMode(),
      });
    }

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
      pricing,
      shippingCharge,
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

export const trackOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderId } = req.params;

    console.log("========== TRACK ORDER ==========");
    console.log("Requested orderId:", orderId);
    console.log("Authenticated userId:", userId);

    const order = await Order.findOne({
      _id: orderId,
      user_id: userId,
    });

    if (!order) {
      return res.status(404).json({
        message: "Order not found.",
      });
    }

    if (!order.shiprocket_awb) {
      return res.status(400).json({
        message: "Tracking is not available for this order yet.",
      });
    }

    const trackingResponse = await getShiprocketTracking(order.shiprocket_awb);

    return res.status(200).json({
      success: true,
      awb: order.shiprocket_awb,
      tracking: trackingResponse.tracking_data || null,
    });
  } catch (error) {
    console.error("Shiprocket tracking error:", error.response?.data || error);

    return res.status(500).json({
      message: "Unable to fetch tracking details.",
    });
  }
};

export const getOrderInvoice = async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderId } = req.params;

    const order = await Order.findOne({
      _id: orderId,
      user_id: userId,
    });

    if (!order) {
      return res.status(404).json({
        message: "Order not found.",
      });
    }

    if (!order.shiprocket_order_id) {
      return res.status(400).json({
        message: "Invoice is not available for this order yet.",
      });
    }

    const invoiceResponse = await generateShiprocketInvoice(
      order.shiprocket_order_id,
    );

    if (!invoiceResponse?.is_invoice_created || !invoiceResponse?.invoice_url) {
      console.error("Shiprocket invoice response:", invoiceResponse);

      return res.status(400).json({
        message: "Shiprocket invoice could not be generated.",
      });
    }

    return res.status(200).json({
      success: true,
      invoiceUrl: invoiceResponse.invoice_url,
    });
  } catch (error) {
    console.error("Shiprocket invoice error:", error.response?.data || error);

    return res.status(500).json({
      message: "Unable to generate invoice.",
    });
  }
};

/**
 * Verify Razorpay payment and confirm order
 */
export const verifyPayment = async (req, res) => {
  console.log("========== VERIFY PAYMENT ==========");
  console.log(req.body);
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
    if (order.payment_status === "Paid") {
      return res.status(200).json({
        success: true,
        message: "Payment already verified.",
        orderId: order.id,
      });
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
    order.status = "Confirmed";
    order.payment_status = "Paid";
    order.razorpay_payment_id = razorpayPaymentId;
    await order.save();

    const payment = new Payment({
      order_id: orderId,
      razorpay_payment_id: razorpayPaymentId,
      amount: order.total_amount,
      status: "captured",
      method: "digital",
    });
    await payment.save();

    // 4. Update inventory and log stock removal
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.product_id, {
        $inc: { stock_quantity: -item.quantity },
      });

      const log = new InventoryLog({
        product_id: item.product_id,
        change_amount: -item.quantity,
        reason: `Purchase - Order #${orderId}`,
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

    // 6. Register with Shiprocket for prepaid orders only
    if (order.payment_method !== "COD") {
      try {
        const address = await Address.findById(order.shipping_address_id);
        if (customer && address) {
          await registerShiprocketShipment({
            order,
            user: customer,
            address,
            items: order.items,
            subtotal: order.pricing?.product_price || 0,
            shippingCharge:
              order.pricing?.delivery_charge ??
              order.pricing?.delivery_charges ??
              order.pricing?.shippingCharge ??
              0,
            paymentMethod: order.payment_method,
          });
        }
      } catch (shipErr) {
        console.error("Shiprocket registration after payment failed:", shipErr);
      }
    } else {
      console.debug(
        "Skipping Shiprocket registration in verifyPayment for COD order",
        orderId,
      );
    }

    // 7. Send invoice via Resend
    try {
      const populatedOrder = await Order.findById(orderId)
        .populate("user_id")
        .populate("shipping_address_id")
        .populate("items.product_id");

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
        country: populatedOrder.shipping_address_id?.country,
      };

      const fullItems = populatedOrder.items.map((item) => ({
        quantity: item.quantity,
        price_at_purchase: item.price_at_purchase,
        name: item.product_id?.name,
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
    const orders = await Order.find({ user_id: userId })
      .sort({ created_at: -1 })
      .lean();

    const formattedOrders = orders.map((o) => ({
      ...o,
      id: o._id.toString(),
      total_items: o.items.length,
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
      .populate("shipping_address_id")
      .populate("items.product_id");

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
    oObj.items = order.items.map((item) => {
      const prod = item.product_id;
      const primaryImage =
        prod?.images?.find((img) => img.is_primary)?.image_url ||
        prod?.images?.[0]?.image_url ||
        null;

      return {
        product_id: prod?._id,
        name: prod?.name,
        slug: prod?.slug,
        quantity: item.quantity,
        price_at_purchase: item.price_at_purchase,
        primary_image: primaryImage,
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
      .populate("user_id")
      .populate("shipping_address_id")
      .populate("items.product_id");

    if (!orderObj) {
      return res.status(404).json({ message: "Order or invoice not found." });
    }

    if (
      userRole !== "admin" &&
      orderObj.user_id?._id.toString() !== userId.toString()
    ) {
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
      country: orderObj.shipping_address_id?.country,
    };

    const items = orderObj.items.map((item) => ({
      quantity: item.quantity,
      price_at_purchase: item.price_at_purchase,
      name: item.product_id?.name,
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
