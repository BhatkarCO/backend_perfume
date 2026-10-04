import crypto from "crypto";
import mongoose from "mongoose";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import InventoryLog from "../models/InventoryLog.js";
import Address from "../models/Address.js";
import Coupon from "../models/Coupon.js";
import { calculateFinalAmount } from "../utils/pricing.js";
import { GST_PERCENTAGE } from "../config/pricing.js";
import {
  checkServiceability,
  createShiprocketOrder,
  assignShiprocketAwb,
  generateShiprocketPickup,
  getShiprocketTracking,
  generateShiprocketInvoice,
  downloadShiprocketInvoice,
  SHIPROCKET_CONFIG,
} from "../config/shiprocket.js";
import User from "../models/User.js";
import razorpayInstance, {
  isMockMode,
  MANUAL_CAPTURE_WINDOW_MS,
} from "../config/razorpay.js";
import {
  captureAuthorizedPayment,
  finalizeSuccessfulPayment,
} from "../services/paymentService.js";
import { sendResendEmail, sendInvoiceEmail } from "../utils/resendEmail.js";
const COD_CHARGE = 65;
const FREE_SHIPPING_MIN_ITEMS = 2;

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
  couponDiscount = 0,
  codCharge = 0,
}) => {
  const orderDate = new Date().toISOString().slice(0, 19).replace("T", " ");
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
      const doc = item._doc || item;

      const quantity = Number(doc.quantity) || 0;

      // price_at_purchase is already GST-inclusive.
      const sellingPriceInclusive = Number(doc.price_at_purchase || 0);

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
    sub_total: Number((subtotal - couponDiscount).toFixed(2)),
    shipping_charges: Number(Number(shippingCharge || 0).toFixed(2)),
    total_discount: Number(Number(couponDiscount || 0).toFixed(2)),
    transaction_charges: Number(Number(codCharge || 0).toFixed(2)),
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
  couponDiscount = 0,
  codCharge = 0,
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

    const payload = buildShiprocketOrderPayload({
      localOrderId: order.id,
      user,
      address,
      items: normalizedItems,
      subtotal,
      shippingCharge,
      paymentMethod,
      couponDiscount,
      codCharge,
    });
    let createResponse;
    try {
      createResponse = await createShiprocketOrder(payload);
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
      console.error("Shiprocket create order failed: shipment_id missing.", {
        orderId: order.id,
      });

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

    const assignResponse = await assignShiprocketAwb(assignRequest);

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
      console.warn(
        "Shiprocket AWB is pending. The shipment was created but no AWB was assigned.",
      );

      order.shiprocket_status = "AWB_PENDING";

      await order.save();

      return order;
    }

    // Save Shiprocket details
    order.shiprocket_awb = String(awbCode);
    order.shiprocket_courier_name = courierName;
    order.shiprocket_shipment_id = assignedShipmentId;

    // Keep this as AWB_ASSIGNED until webhook updates the
    // actual Shiprocket shipment status.
    order.shiprocket_status = "AWB_ASSIGNED";

    await order.save();

    return order;
  } catch (error) {
    console.error("Shiprocket API error:", {
      status: error.response?.status,
    });

    return order;
  }
};

const validateOrderItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    return "At least one product is required.";
  }

  if (items.length > 50) {
    return "Too many items in one order.";
  }

  for (const item of items) {
    if (!item?.productId) {
      return "Invalid product ID.";
    }

    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 20
    ) {
      return "Quantity must be an integer between 1 and 20.";
    }
  }

  return null;
};

/**
 * Preview Order Pricing
 * Calculates GST-inclusive product subtotal, coupon,
 * COD charge and Shiprocket delivery charges
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
  const validationError = validateOrderItems(items);

  if (validationError) {
    return res.status(400).json({
      message: validationError,
    });
  }

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
    let productDiscountTotal = 0;

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

      const basePrice = product.sale_price
        ? Number(product.sale_price)
        : Number(product.price);

      // Sale price is already GST-inclusive.
      // DO NOT add GST here.
      const activePrice = basePrice;

      const productDiscount = product.sale_price
        ? Math.max(0, Number(product.price) - Number(product.sale_price))
        : 0;

      productDiscountTotal += productDiscount * item.quantity;

      subtotal += activePrice * item.quantity;

      itemsWithPrice.push({
        product,
        quantity: item.quantity,
        price: activePrice,
        base_price: basePrice,
        product_discount: productDiscount,
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

    const totalQuantity = items.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0,
    );

    const shippingCharge =
      totalQuantity >= FREE_SHIPPING_MIN_ITEMS
        ? 0
        : Number(recommendedCourier.freight_charge);

    // -----------------------------------
    // Pricing
    // -----------------------------------

    const codCharge = paymentMethod === "COD" ? COD_CHARGE : 0;

    const pricing = calculateFinalAmount({
      productPrice: subtotal,
      shippingCharge,
      discount,
      productDiscount: productDiscountTotal,
      codCharge,
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
    console.error("Order preview failed.");

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
  const validationError = validateOrderItems(items);

  if (validationError) {
    return res.status(400).json({
      message: validationError,
    });
  }

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

    const totalQuantity = items.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0,
    );

    const shippingCharge =
      totalQuantity >= FREE_SHIPPING_MIN_ITEMS
        ? 0
        : Number(recommendedCourier.freight_charge);

    // 2. Fetch products and calculate total cost in a single batch query
    const quantitiesByProduct = new Map();
    for (const item of items) {
      const productId = String(item.productId);
      quantitiesByProduct.set(
        productId,
        (quantitiesByProduct.get(productId) || 0) + item.quantity,
      );
    }
    const aggregatedItems = Array.from(
      quantitiesByProduct,
      ([productId, quantity]) => ({ productId, quantity }),
    );
    const productIds = aggregatedItems.map((item) => item.productId);
    const products = await Product.find({ _id: { $in: productIds } }).lean();

    const productMap = {};
    products.forEach((p) => {
      productMap[p._id.toString()] = p;
    });

    let subtotal = 0;
    let productDiscountTotal = 0;

    const itemsWithPrice = [];

    for (const item of aggregatedItems) {
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

      const basePrice = product.sale_price
        ? Number(product.sale_price)
        : Number(product.price);

      // Sale price already includes GST.
      const activePrice = basePrice;

      const productDiscount = product.sale_price
        ? Math.max(0, Number(product.price) - Number(product.sale_price))
        : 0;

      subtotal += activePrice * item.quantity;

      productDiscountTotal += productDiscount * item.quantity;

      itemsWithPrice.push({
        product_id: product._id.toString(),
        name: product.name,
        quantity: item.quantity,

        // This is the actual customer selling price.
        // It already includes GST.
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

    const codCharge = paymentMethod === "COD" ? COD_CHARGE : 0;

    const pricing = calculateFinalAmount({
      productPrice: subtotal,
      shippingCharge,
      discount,
      productDiscount: productDiscountTotal,
      codCharge,
    });

    const totalAmount = pricing.final_payable;

    pricing.cod_charge = codCharge;
    pricing.final_payable = totalAmount;

    // 4. Create local order record in 'Pending' status
    let newOrder = new Order({
      user_id: userId,

      status: "Pending",

      payment_method: paymentMethod,
      payment_status: "Pending",
      inventory_status: "Reserved",
      inventory_reserved_at: new Date(),

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

    const localOrderId = newOrder.id;

    // Create the provider order before reserving stock so a provider failure
    // cannot leave inventory held by an order that has no payment session.
    let rzpOrderId = null;
    if (paymentMethod !== "COD") {
      rzpOrderId = `mock_order_${localOrderId}_${Date.now()}`;

      if (!isMockMode()) {
        try {
          const options = {
            amount: Math.round(totalAmount * 100),
            currency: "INR",
            receipt: `receipt_order_${localOrderId}`,
          };
          const rzpOrder = await razorpayInstance.orders.create(options);
          rzpOrderId = rzpOrder.id;
          const providerCreatedAt = new Date(
            Number(rzpOrder.created_at) * 1000,
          );
          if (Number.isFinite(providerCreatedAt.getTime())) {
            newOrder.razorpay_order_created_at = providerCreatedAt;
            newOrder.inventory_reservation_expires_at = new Date(
              providerCreatedAt.getTime() + MANUAL_CAPTURE_WINDOW_MS,
            );
          }
        } catch (rzpErr) {
          console.error("Razorpay order creation failed.");
          throw rzpErr;
        }
      }

      newOrder.razorpay_order_id = rzpOrderId;
    }
    const orderData = newOrder.toObject();

    // Prepaid reservations are not auto-released: the current Razorpay flow
    // has no trusted terminal-expiry signal that rules out a later capture.
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const item of itemsWithPrice) {
          const stockUpdate = await Product.updateOne(
            {
              _id: item.product_id,
              stock_quantity: { $gte: item.quantity },
            },
            { $inc: { stock_quantity: -item.quantity } },
            { session },
          );

          if (stockUpdate.matchedCount !== 1) {
            const stockError = new Error(
              `Insufficient stock for product ${item.name}.`,
            );
            stockError.code = "INSUFFICIENT_STOCK";
            throw stockError;
          }

          await InventoryLog.create(
            [
              {
                product_id: item.product_id,
                change_amount: -item.quantity,
                reason: `Reserved - Order #${localOrderId}`,
              },
            ],
            { session },
          );
        }

        const orderToSave = new Order(orderData);
        await orderToSave.save({ session });
        newOrder = orderToSave;
      });
    } finally {
      await session.endSession();
    }

    // ===========================
    // CASH ON DELIVERY FLOW
    // ===========================
    if (paymentMethod === "COD") {
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
            couponDiscount: discount,
            codCharge,
          });
        }
      } catch (shipErr) {
        console.error("COD Shiprocket registration failed.");
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
    if (error.code === "INSUFFICIENT_STOCK") {
      return res.status(400).json({ message: error.message });
    }
    console.error("Create order checkout failed.");
    res.status(500).json({ message: "Internal server error." });
  }
};

export const trackOrder = async (req, res) => {
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
    console.error("Shiprocket tracking request failed.");

    return res.status(500).json({
      message: "Unable to fetch tracking details.",
    });
  }
};

/**
 * Verify Razorpay payment and confirm order
 */
export const verifyPayment = async (req, res) => {
  const userId = req.user.id;
  const { orderId, razorpayPaymentId, razorpayOrderId, razorpaySignature } =
    req.body;

  if (
    !orderId ||
    !razorpayPaymentId ||
    !razorpayOrderId ||
    !razorpaySignature
  ) {
    return res.status(400).json({
      message: "Required payment parameters missing.",
    });
  }

  if (
    !isMockMode() &&
    [razorpayPaymentId, razorpayOrderId].some(
      (id) => typeof id === "string" && id.startsWith("mock_"),
    )
  ) {
    return res.status(400).json({
      message: "Mock payment identifiers are not accepted.",
    });
  }

  try {
    // 1. Fetch local order
    const order = await Order.findOne({ _id: orderId, user_id: userId });
    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }
    if (order.razorpay_order_id !== razorpayOrderId) {
      return res.status(400).json({
        message: "Payment does not belong to this order.",
      });
    }
    if (order.payment_status === "Paid") {
      return res.status(200).json({
        success: true,
        message: "Payment already verified.",
        orderId: order.id,
      });
    }
    if (order.inventory_status === "Released") {
      return res.status(409).json({
        message: "The payment reservation for this order has expired.",
      });
    }
    if (order.status !== "Pending") {
      return res
        .status(400)
        .json({ message: "Order has already been processed." });
    }

    // 2. Signature verification
    let isPaymentValid = false;

    if (isMockMode()) {
      // Mock payments are allowed only when the SERVER is
      // explicitly running in non-production mock mode.
      isPaymentValid = true;
    } else {
      const keySecret = process.env.RAZORPAY_KEY_SECRET;

      if (!keySecret) {
        return res.status(500).json({
          message: "Payment configuration error.",
        });
      }

      const expectedSignature = crypto
        .createHmac("sha256", keySecret)
        .update(razorpayOrderId + "|" + razorpayPaymentId)
        .digest("hex");

      const receivedBuffer = Buffer.from(String(razorpaySignature), "utf8");

      const expectedBuffer = Buffer.from(expectedSignature, "utf8");

      isPaymentValid =
        receivedBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
    }

    if (!isPaymentValid) {
      return res.status(400).json({
        message: "Payment signature verification failed.",
      });
    }

    // 3. Verify the real Razorpay payment
    if (!isMockMode()) {
      try {
        let paymentDetails =
          await razorpayInstance.payments.fetch(razorpayPaymentId);

        const expectedAmount = Math.round(Number(order.total_amount) * 100);

        if (paymentDetails.order_id !== order.razorpay_order_id) {
          return res.status(400).json({
            message: "Payment does not belong to this order.",
          });
        }

        if (paymentDetails.amount !== expectedAmount) {
          return res.status(400).json({
            message: "Payment amount does not match the order.",
          });
        }

        if (paymentDetails.currency !== "INR") {
          return res.status(400).json({
            message: "Invalid payment currency.",
          });
        }

        if (paymentDetails.status === "authorized") {
          paymentDetails = await captureAuthorizedPayment({
            orderId: order._id,
            razorpayPaymentId,
            razorpayOrderId,
            amountPaise: Number(paymentDetails.amount),
            currency: paymentDetails.currency,
            paymentMethod: paymentDetails.method || "digital",
          });
        }

        if (paymentDetails.status !== "captured") {
          return res.status(400).json({
            message: "Payment has not been captured.",
          });
        }
      } catch (error) {
        console.error("Razorpay payment verification error:", error.message);

        return res.status(502).json({
          message: "Unable to verify payment with Razorpay.",
        });
      }
    }

    // ----------------------------------------
    // 4. Finalize payment atomically
    // ----------------------------------------

    let finalizationResult;

    try {
      finalizationResult = await finalizeSuccessfulPayment({
        orderId: order._id,
        razorpayPaymentId,
        razorpayOrderId,
        amountPaise: Math.round(Number(order.total_amount) * 100),
        currency: "INR",
        paymentStatus: "captured",
        paymentMethod: "digital",
      });
    } catch (finalizeError) {
      console.error("Payment finalization failed:", finalizeError.message);

      return res.status(400).json({
        message: finalizeError.message,
      });
    }

    if (finalizationResult.alreadyFinalized) {
      return res.status(200).json({
        success: true,
        message: "Payment already verified.",
        orderId: order.id,
      });
    }

    const customer = await User.findById(userId);

    if (!customer) {
      console.error(
        "Customer not found while registering Shiprocket shipment.",
      );
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

            couponDiscount:
              order.pricing?.coupon_discount ?? order.discount_amount ?? 0,

            codCharge: order.pricing?.cod_charge ?? 0,
          });
        }
      } catch (shipErr) {
        console.error("Shiprocket registration after payment failed.");
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
    const orders = await Order.find({
      user_id: userId,
      $or: [
        { payment_method: "COD" },
        { payment_method: "RAZORPAY", payment_status: "Paid" },
      ],
    })
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
    // ----------------------------------------
    // Find order
    // ----------------------------------------

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        message: "Order not found.",
      });
    }

    // ----------------------------------------
    // Authorization
    // ----------------------------------------

    if (
      userRole !== "admin" &&
      order.user_id.toString() !== userId.toString()
    ) {
      return res.status(403).json({
        message: "Unauthorized action.",
      });
    }

    // ----------------------------------------
    // Check Shiprocket order
    // ----------------------------------------

    if (!order.shiprocket_order_id) {
      return res.status(400).json({
        message: "Invoice is not available for this order yet.",
      });
    }

    // ----------------------------------------
    // Generate Shiprocket invoice
    // ----------------------------------------

    const invoiceResponse = await generateShiprocketInvoice(
      order.shiprocket_order_id,
    );

    // ----------------------------------------
    // Get invoice URL
    // ----------------------------------------

    const invoiceUrl =
      invoiceResponse?.invoice_url ||
      invoiceResponse?.invoiceUrl ||
      invoiceResponse?.url ||
      invoiceResponse?.data?.invoice_url ||
      invoiceResponse?.data?.invoiceUrl ||
      invoiceResponse?.data?.url;

    if (!invoiceUrl) {
      console.error("Shiprocket invoice URL missing.");

      return res.status(400).json({
        message: "Shiprocket invoice could not be generated.",
      });
    }

    // ----------------------------------------
    // Download PDF from Shiprocket
    // ----------------------------------------

    const pdfBuffer = await downloadShiprocketInvoice(invoiceUrl);

    // ----------------------------------------
    // Send Shiprocket PDF to frontend
    // ----------------------------------------

    res.setHeader("Content-Type", "application/pdf");

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Invoice_Bhatkar_${orderId}.pdf"`,
    );

    res.setHeader("Content-Length", pdfBuffer.length);

    return res.status(200).send(pdfBuffer);
  } catch (error) {
    console.error("Invoice PDF download failed.");

    return res.status(500).json({
      message: "Unable to generate invoice.",
    });
  }
};
