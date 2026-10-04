import mongoose from "mongoose";
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import Product from "../models/Product.js";
import InventoryLog from "../models/InventoryLog.js";
import razorpayInstance, {
  MANUAL_CAPTURE_WINDOW_MS,
  isManualCapturePolicyEnabled,
} from "../config/razorpay.js";

const validateProviderPayment = (payment, order, razorpayOrderId) => {
  const expectedAmountPaise = Math.round(Number(order.total_amount) * 100);

  if (
    payment?.order_id !== razorpayOrderId ||
    Number(payment.amount) !== expectedAmountPaise ||
    payment.currency !== "INR"
  ) {
    throw new Error("Razorpay payment does not match the order.");
  }
};

const claimAuthorizedPayment = async ({
  orderId,
  razorpayPaymentId,
  razorpayOrderId,
  amountPaise,
  currency,
}) => {
  const session = await mongoose.startSession();

  try {
    let claimedOrder = null;

    await session.withTransaction(async () => {
      const order = await Order.findOne({
        _id: orderId,
        razorpay_order_id: razorpayOrderId,
        inventory_status: "Reserved",
        inventory_reservation_expires_at: { $gt: new Date() },
        status: "Pending",
        payment_status: { $in: ["Pending", "Failed"] },
      }).session(session);

      if (!order) {
        throw new Error("Order reservation is not active.");
      }

      validateProviderPayment(
        { order_id: razorpayOrderId, amount: amountPaise, currency },
        order,
        razorpayOrderId,
      );

      const productIds = [
        ...new Set(order.items.map((item) => item.product_id.toString())),
      ];
      const existingProducts = await Product.countDocuments({
        _id: { $in: productIds },
      }).session(session);

      if (existingProducts !== productIds.length) {
        throw new Error("Reserved inventory is no longer valid.");
      }

      const claimed = await Order.findOneAndUpdate(
        {
          _id: order._id,
          inventory_status: "Reserved",
          inventory_reservation_expires_at: { $gt: new Date() },
          status: "Pending",
          payment_status: { $in: ["Pending", "Failed"] },
          $or: [
            { razorpay_capture_claimed_payment_id: { $exists: false } },
            { razorpay_capture_claimed_payment_id: razorpayPaymentId },
          ],
        },
        {
          $set: {
            razorpay_capture_claimed_payment_id: razorpayPaymentId,
            razorpay_capture_claimed_at: new Date(),
          },
        },
        { returnDocument: "after", session },
      );

      if (!claimed) {
        throw new Error("Another payment is already being captured.");
      }

      claimedOrder = claimed;
    });

    return claimedOrder;
  } finally {
    await session.endSession();
  }
};

/**
 * Capture an authorized payment only while its inventory reservation is active.
 * A captured provider response is always fetched again before local finalization.
 */
export const captureAuthorizedPayment = async ({
  orderId,
  razorpayPaymentId,
  razorpayOrderId,
  amountPaise,
  currency = "INR",
  paymentMethod = "digital",
}) => {
  if (!isManualCapturePolicyEnabled()) {
    throw new Error("Manual Razorpay capture policy is not enabled.");
  }

  if (!razorpayInstance) {
    throw new Error("Razorpay is not configured.");
  }

  const order = await Order.findOne({
    _id: orderId,
    razorpay_order_id: razorpayOrderId,
  });

  if (!order) {
    throw new Error("Order not found for authorized payment.");
  }

  const payment = await razorpayInstance.payments.fetch(razorpayPaymentId);
  validateProviderPayment(payment, order, razorpayOrderId);

  if (payment.status === "captured") {
    await finalizeSuccessfulPayment({
      orderId: order._id,
      razorpayPaymentId,
      razorpayOrderId,
      amountPaise: payment.amount,
      currency: payment.currency,
      paymentStatus: payment.status,
      paymentMethod: payment.method || paymentMethod,
    });
    return payment;
  }

  if (payment.status !== "authorized") {
    throw new Error("Razorpay payment is no longer authorized.");
  }

  await claimAuthorizedPayment({
    orderId: order._id,
    razorpayPaymentId,
    razorpayOrderId,
    amountPaise: payment.amount,
    currency: payment.currency,
  });

  try {
    await razorpayInstance.payments.capture(
      razorpayPaymentId,
      Number(payment.amount),
      payment.currency,
    );
  } catch (captureError) {
    // Capture can race an automatic/provider-side capture. Only a subsequent
    // authenticated API fetch can establish that it is safe to finalize.
    const refreshedPayment =
      await razorpayInstance.payments.fetch(razorpayPaymentId);
    validateProviderPayment(refreshedPayment, order, razorpayOrderId);
    if (refreshedPayment.status !== "captured") {
      throw captureError;
    }
  }

  const capturedPayment =
    await razorpayInstance.payments.fetch(razorpayPaymentId);
  validateProviderPayment(capturedPayment, order, razorpayOrderId);

  if (capturedPayment.status !== "captured") {
    throw new Error("Razorpay did not confirm payment capture.");
  }

  await finalizeSuccessfulPayment({
    orderId: order._id,
    razorpayPaymentId,
    razorpayOrderId,
    amountPaise: capturedPayment.amount,
    currency: capturedPayment.currency,
    paymentStatus: capturedPayment.status,
    paymentMethod: capturedPayment.method || paymentMethod,
  });

  return capturedPayment;
};

const releasePrepaidReservation = async ({ orderId, now }) => {
  const session = await mongoose.startSession();

  try {
    let released = false;

    await session.withTransaction(async () => {
      const order = await Order.findOne({
        _id: orderId,
        payment_method: "RAZORPAY",
        status: { $in: ["Pending", "Cancelled"] },
        payment_status: { $ne: "Paid" },
        inventory_status: "Reserved",
        inventory_reservation_expires_at: { $lte: now },
      }).session(session);

      if (!order) {
        return;
      }

      const releaseFilter = {
        _id: order._id,
        payment_method: "RAZORPAY",
        status: { $in: ["Pending", "Cancelled"] },
        payment_status: { $ne: "Paid" },
        inventory_status: "Reserved",
        inventory_reservation_expires_at: { $lte: now },
      };

      if (order.razorpay_capture_claimed_payment_id) {
        releaseFilter.razorpay_capture_claimed_payment_id =
          order.razorpay_capture_claimed_payment_id;
      } else {
        releaseFilter.razorpay_capture_claimed_payment_id = {
          $exists: false,
        };
      }

      const releasedOrder = await Order.findOneAndUpdate(
        releaseFilter,
        {
          $set: {
            inventory_status: "Released",
            inventory_released_at: now,
            inventory_release_reason: "razorpay_capture_window_elapsed",
            status: "Cancelled",
          },
          $unset: {
            razorpay_capture_claimed_payment_id: 1,
            razorpay_capture_claimed_at: 1,
          },
        },
        { returnDocument: "after", session },
      );

      if (!releasedOrder) {
        return;
      }

      const quantitiesByProduct = new Map();
      for (const item of releasedOrder.items) {
        const productId = item.product_id.toString();
        quantitiesByProduct.set(
          productId,
          (quantitiesByProduct.get(productId) || 0) + Number(item.quantity),
        );
      }

      for (const [productId, quantity] of quantitiesByProduct) {
        if (!Number.isInteger(quantity) || quantity < 1) {
          throw new Error("Invalid reserved inventory quantity.");
        }

        const stockUpdate = await Product.updateOne(
          { _id: productId },
          { $inc: { stock_quantity: quantity } },
          { session },
        );

        if (stockUpdate.matchedCount !== 1) {
          throw new Error("Unable to restore reserved product inventory.");
        }

        await InventoryLog.create(
          [
            {
              product_id: productId,
              change_amount: quantity,
              reason: `Released - Order #${releasedOrder._id}`,
            },
          ],
          { session },
        );
      }

      released = true;
    });

    return released;
  } finally {
    await session.endSession();
  }
};

const extendReservationToProviderBoundary = async (order, boundary) => {
  if (
    !Number.isFinite(boundary.getTime()) ||
    boundary <= order.inventory_reservation_expires_at
  ) {
    return;
  }

  await Order.updateOne(
    {
      _id: order._id,
      inventory_status: "Reserved",
      inventory_reservation_expires_at: {
        $lt: boundary,
      },
    },
    {
      $set: {
        inventory_reservation_expires_at: boundary,
      },
    },
  );
};

/**
 * Reconcile expired reservations only after Razorpay confirms that no payment
 * remains captured or in a non-terminal/capturable state.
 */
export const reconcileExpiredPrepaidReservations = async () => {
  if (!isManualCapturePolicyEnabled() || !razorpayInstance) {
    return { processed: 0, released: 0 };
  }

  const now = new Date();
  const expiredOrders = await Order.find({
    payment_method: "RAZORPAY",
    payment_status: { $ne: "Paid" },
    inventory_status: "Reserved",
    inventory_reservation_expires_at: { $lte: now },
    razorpay_order_id: { $exists: true, $ne: null },
  })
    .sort({ inventory_reservation_expires_at: 1 })
    .limit(50)
    .lean();

  let releasedCount = 0;

  for (const order of expiredOrders) {
    try {
      const providerOrder = await razorpayInstance.orders.fetch(
        order.razorpay_order_id,
      );
      const expectedAmount = Math.round(Number(order.total_amount) * 100);

      if (
        providerOrder.id !== order.razorpay_order_id ||
        Number(providerOrder.amount) !== expectedAmount ||
        providerOrder.currency !== "INR" ||
        !["created", "attempted", "paid"].includes(providerOrder.status) ||
        providerOrder.status === "paid"
      ) {
        continue;
      }

      const providerOrderCreatedAt = new Date(
        Number(providerOrder.created_at) * 1000,
      );
      if (!Number.isFinite(providerOrderCreatedAt.getTime())) {
        continue;
      }

      const paymentResponse = await razorpayInstance.orders.fetchPayments(
        order.razorpay_order_id,
      );
      const payments = paymentResponse?.items;

      if (
        !Array.isArray(payments) ||
        (providerOrder.status === "attempted" && payments.length === 0) ||
        (Number.isInteger(Number(paymentResponse.count)) &&
          Number(paymentResponse.count) > payments.length)
      ) {
        continue;
      }

      let capturedPayment = null;
      let allPaymentsTerminal = true;
      let latestCaptureBoundary = new Date(
        providerOrderCreatedAt.getTime() + MANUAL_CAPTURE_WINDOW_MS,
      );

      for (const providerPayment of payments) {
        if (
          providerPayment.order_id &&
          providerPayment.order_id !== order.razorpay_order_id
        ) {
          allPaymentsTerminal = false;
          break;
        }

        if (providerPayment.status === "captured") {
          capturedPayment = await razorpayInstance.payments.fetch(
            providerPayment.id,
          );
          validateProviderPayment(
            capturedPayment,
            order,
            order.razorpay_order_id,
          );
          break;
        }

        if (providerPayment.status === "refunded") {
          continue;
        }

        const paymentCreatedAt = new Date(
          Number(providerPayment.created_at) * 1000,
        );

        if (!Number.isFinite(paymentCreatedAt.getTime())) {
          allPaymentsTerminal = false;
          break;
        }

        const paymentCaptureBoundary = new Date(
          paymentCreatedAt.getTime() + MANUAL_CAPTURE_WINDOW_MS,
        );
        if (paymentCaptureBoundary > latestCaptureBoundary) {
          latestCaptureBoundary = paymentCaptureBoundary;
        }

        if (
          providerPayment.status !== "failed" ||
          paymentCaptureBoundary > now
        ) {
          allPaymentsTerminal = false;
        }
      }

      if (capturedPayment?.status === "captured") {
        await finalizeSuccessfulPayment({
          orderId: order._id,
          razorpayPaymentId: capturedPayment.id,
          razorpayOrderId: order.razorpay_order_id,
          amountPaise: capturedPayment.amount,
          currency: capturedPayment.currency,
          paymentStatus: capturedPayment.status,
          paymentMethod: capturedPayment.method || "digital",
        });
        continue;
      }

      await extendReservationToProviderBoundary(order, latestCaptureBoundary);

      if (!allPaymentsTerminal || providerOrder.status === "paid") {
        continue;
      }

      const released = await releasePrepaidReservation({
        orderId: order._id,
        now,
      });
      if (released) {
        releasedCount += 1;
      }
    } catch (error) {
      console.error(
        `Prepaid reservation reconciliation failed for order ${order._id}:`,
        error.message,
      );
    }
  }

  return { processed: expiredOrders.length, released: releasedCount };
};

/**
 * Finalize a successfully captured Razorpay payment.
 *
 * This function is shared by:
 * - /orders/verify
 * - Razorpay webhook
 *
 * Responsibilities:
 * - Validate order/payment relationship
 * - Prevent duplicate payment processing
 * - Create/update Payment record
 * - Deduct inventory safely
 * - Create inventory logs
 * - Mark order as Confirmed + Paid
 *
 * The Razorpay signature itself is NOT verified here.
 * The caller must verify the signature/payment before calling this service.
 */
export const finalizeSuccessfulPayment = async ({
  orderId,
  razorpayPaymentId,
  razorpayOrderId,
  amountPaise,
  currency = "INR",
  paymentStatus = "captured",
  paymentMethod = "digital",
}) => {
  if (!orderId) {
    throw new Error("Order ID is required.");
  }

  if (!razorpayPaymentId) {
    throw new Error("Razorpay payment ID is required.");
  }

  if (!razorpayOrderId) {
    throw new Error("Razorpay order ID is required.");
  }

  if (currency !== "INR") {
    throw new Error("Invalid payment currency.");
  }

  if (paymentStatus !== "captured") {
    throw new Error("Payment has not been captured.");
  }

  const normalizedAmountPaise = Number(amountPaise);

  if (!Number.isFinite(normalizedAmountPaise) || normalizedAmountPaise <= 0) {
    throw new Error("Invalid payment amount.");
  }

  const session = await mongoose.startSession();

  try {
    let result = null;

    await session.withTransaction(async () => {
      // ----------------------------------------
      // 1. Find the local order
      // ----------------------------------------

      const order = await Order.findById(orderId).session(session);

      if (!order) {
        throw new Error("Order not found.");
      }

      // ----------------------------------------
      // 2. Make sure Razorpay order belongs
      //    to this local order
      // ----------------------------------------

      if (order.razorpay_order_id !== razorpayOrderId) {
        throw new Error("Payment does not belong to this order.");
      }

      // ----------------------------------------
      // 3. Verify payment amount
      // ----------------------------------------

      const expectedAmountPaise = Math.round(Number(order.total_amount) * 100);

      if (normalizedAmountPaise !== expectedAmountPaise) {
        throw new Error("Payment amount does not match the order.");
      }

      // ----------------------------------------
      // 4. Idempotency check
      // ----------------------------------------
      // If the browser and webhook both reach this
      // function, only the first successful transaction
      // should finalize the order.

      // ----------------------------------------
      // 5. Claim this payment ID before touching inventory.
      //    The unique Payment index makes this claim global.
      // ----------------------------------------

      const existingPayment = await Payment.findOne({
        razorpay_payment_id: razorpayPaymentId,
      }).session(session);

      if (
        existingPayment?.order_id &&
        existingPayment.order_id.toString() !== order._id.toString()
      ) {
        throw new Error(
          "This Razorpay payment is already linked to another order.",
        );
      }

      if (order.payment_status === "Paid") {
        if (order.razorpay_payment_id !== razorpayPaymentId) {
          throw new Error("Order is already paid with a different payment.");
        }

        result = {
          alreadyFinalized: true,
          order,
        };

        return;
      }

      if (existingPayment?.status === "captured") {
        throw new Error(
          "This Razorpay payment was already captured without finalizing this order.",
        );
      }

      if (!["Pending", "Cancelled"].includes(order.status)) {
        throw new Error("Order cannot be finalized from its current status.");
      }

      if (order.inventory_status === "Released") {
        throw new Error("Order inventory reservation has been released.");
      }

      const paymentData = {
        order_id: order._id,
        razorpay_payment_id: razorpayPaymentId,
        amount: Number(order.total_amount),
        status: "captured",
        method: paymentMethod,
        error_description: undefined,
      };

      if (existingPayment) {
        const paymentClaim = await Payment.updateOne(
          {
            _id: existingPayment._id,
            order_id: order._id,
            status: { $ne: "captured" },
          },
          { $set: paymentData, $unset: { error_description: 1 } },
          { session },
        );
        if (paymentClaim.matchedCount !== 1) {
          throw new Error("Unable to claim Razorpay payment.");
        }
      } else {
        await Payment.create([paymentData], { session });
      }

      // New checkouts reserve stock atomically at order creation. Keep the
      // legacy deduction path for orders created before reservations existed.
      if (!order.inventory_status) {
        const quantitiesByProduct = new Map();
        for (const item of order.items) {
          const quantity = Number(item.quantity);
          if (!Number.isInteger(quantity) || quantity < 1) {
            throw new Error("Invalid order quantity.");
          }

          const productId = item.product_id.toString();
          quantitiesByProduct.set(
            productId,
            (quantitiesByProduct.get(productId) || 0) + quantity,
          );
        }

        for (const [productId, quantity] of quantitiesByProduct) {
          const inventoryUpdate = await Product.updateOne(
            {
              _id: productId,
              stock_quantity: { $gte: quantity },
            },
            { $inc: { stock_quantity: -quantity } },
            { session },
          );

          if (inventoryUpdate.modifiedCount !== 1) {
            throw new Error(`Insufficient stock for product ${productId}.`);
          }

          await InventoryLog.create(
            [
              {
                product_id: productId,
                change_amount: -quantity,
                reason: `Purchase - Order #${order._id}`,
              },
            ],
            { session },
          );
        }
      }

      // ----------------------------------------
      // 7. Mark the order paid only if it remains unpaid.
      // ----------------------------------------

      const finalizedOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          razorpay_order_id: razorpayOrderId,
          status: { $in: ["Pending", "Cancelled"] },
          payment_status: { $ne: "Paid" },
          inventory_status: { $ne: "Released" },
        },
        {
          $set: {
            status: "Confirmed",
            payment_status: "Paid",
            inventory_status: "Committed",
            razorpay_payment_id: razorpayPaymentId,
          },
          $unset: {
            razorpay_capture_claimed_payment_id: 1,
            razorpay_capture_claimed_at: 1,
          },
        },
        { returnDocument: "after", session },
      );

      if (!finalizedOrder) {
        throw new Error("Order state changed before payment finalization.");
      }

      result = {
        alreadyFinalized: false,
        order: finalizedOrder,
      };
    });

    return result;
  } catch (error) {
    if (error?.code === 11000) {
      const existingPayment = await Payment.findOne({
        razorpay_payment_id: razorpayPaymentId,
      });

      if (
        existingPayment?.status === "captured" &&
        existingPayment.order_id?.toString() === orderId.toString()
      ) {
        const order = await Order.findById(orderId);
        if (
          order?.payment_status === "Paid" &&
          order.razorpay_payment_id === razorpayPaymentId
        ) {
          return { alreadyFinalized: true, order };
        }
      }
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

/**
 * Mark a Razorpay payment as failed.
 *
 * Important:
 * An already-paid order will never be changed back
 * to Failed.
 */
export const markPaymentFailed = async ({
  orderId,
  razorpayPaymentId,
  razorpayOrderId,
  amountPaise,
  paymentMethod = "digital",
  errorDescription = null,
}) => {
  if (!orderId) {
    throw new Error("Order ID is required.");
  }

  if (!razorpayPaymentId) {
    throw new Error("Razorpay payment ID is required.");
  }

  if (!razorpayOrderId) {
    throw new Error("Razorpay order ID is required.");
  }

  const session = await mongoose.startSession();

  try {
    let result = null;

    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session);

      if (!order) {
        throw new Error("Order not found.");
      }

      if (order.razorpay_order_id !== razorpayOrderId) {
        throw new Error("Payment does not belong to this order.");
      }

      const existingPayment = await Payment.findOne({
        razorpay_payment_id: razorpayPaymentId,
      }).session(session);

      if (
        existingPayment?.order_id &&
        existingPayment.order_id.toString() !== order._id.toString()
      ) {
        throw new Error("This Razorpay payment is linked to another order.");
      }

      if (
        order.payment_status === "Paid" ||
        existingPayment?.status === "captured"
      ) {
        result = { alreadyPaid: true, order };
        return;
      }

      if (order.status !== "Pending") {
        result = { alreadyPaid: false, order, notUpdated: true };
        return;
      }

      const normalizedAmountPaise = Number(amountPaise);
      const amount =
        Number.isFinite(normalizedAmountPaise) && normalizedAmountPaise > 0
          ? normalizedAmountPaise / 100
          : Number(order.total_amount);

      const failedOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          razorpay_order_id: razorpayOrderId,
          status: "Pending",
          payment_status: { $ne: "Paid" },
          ...(order.razorpay_capture_claimed_payment_id === razorpayPaymentId
            ? {
                razorpay_capture_claimed_payment_id: razorpayPaymentId,
              }
            : {}),
        },
        order.razorpay_capture_claimed_payment_id === razorpayPaymentId
          ? {
              $set: { payment_status: "Failed" },
              $unset: {
                razorpay_capture_claimed_payment_id: 1,
                razorpay_capture_claimed_at: 1,
              },
            }
          : { $set: { payment_status: "Failed" } },
        { returnDocument: "after", session },
      );

      if (!failedOrder) {
        result = { alreadyPaid: true, order };
        return;
      }

      const paymentData = {
        order_id: order._id,
        razorpay_payment_id: razorpayPaymentId,
        amount,
        status: "failed",
        method: paymentMethod,
        error_description: errorDescription,
      };

      if (existingPayment) {
        const paymentUpdate = await Payment.updateOne(
          {
            _id: existingPayment._id,
            order_id: order._id,
            status: { $ne: "captured" },
          },
          { $set: paymentData },
          { session },
        );
        if (paymentUpdate.matchedCount !== 1) {
          throw new Error("Payment state changed during failure processing.");
        }
      } else {
        await Payment.create([paymentData], { session });
      }

      result = { alreadyPaid: false, order: failedOrder };
    });

    return result;
  } finally {
    await session.endSession();
  }
};
