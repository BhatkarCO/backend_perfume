import express from "express";
import crypto from "crypto";
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";

const router = express.Router();

router.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
      const signature = req.headers["x-razorpay-signature"];
      const eventId = req.headers["x-razorpay-event-id"];

      if (!webhookSecret) {
        console.error("RAZORPAY_WEBHOOK_SECRET is not configured");
        return res.status(500).json({
          message: "Webhook secret is not configured",
        });
      }

      if (!signature) {
        return res.status(400).json({
          message: "Missing Razorpay webhook signature",
        });
      }

      // IMPORTANT:
      // req.body must be the raw Buffer.
      const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(req.body)
        .digest("hex");

      const receivedBuffer = Buffer.from(signature, "utf8");
      const expectedBuffer = Buffer.from(expectedSignature, "utf8");

      if (
        receivedBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
      ) {
        console.error("Invalid Razorpay webhook signature");

        return res.status(400).json({
          message: "Invalid webhook signature",
        });
      }

      const event = JSON.parse(req.body.toString("utf8"));

      console.log(
        `Razorpay webhook received: ${event.event}`,
        eventId ? `(${eventId})` : ""
      );

      /*
       * Acknowledge Razorpay after signature verification.
       *
       * For a simple MongoDB application this keeps the endpoint responsive.
       */
      res.status(200).json({
        success: true,
      });

      // Process asynchronously after acknowledging Razorpay.
      setImmediate(async () => {
        try {
          await processRazorpayEvent(event, eventId);
        } catch (error) {
          console.error(
            "Razorpay webhook processing error:",
            error
          );
        }
      });
    } catch (error) {
      console.error("Razorpay webhook error:", error);

      if (!res.headersSent) {
        return res.status(400).json({
          message: "Invalid webhook payload",
        });
      }
    }
  }
);

async function processRazorpayEvent(event, eventId) {
  const paymentEntity =
    event.payload?.payment?.entity;

  const orderEntity =
    event.payload?.order?.entity;

  switch (event.event) {
    case "payment.captured": {
      if (!paymentEntity) {
        console.warn("payment.captured without payment entity");
        return;
      }

      await handlePaymentCaptured(paymentEntity, eventId);
      break;
    }

    case "order.paid": {
      if (!paymentEntity && !orderEntity) {
        console.warn("order.paid without payment/order entity");
        return;
      }

      await handleOrderPaid(
        paymentEntity,
        orderEntity,
        eventId
      );

      break;
    }

    case "payment.failed": {
      if (!paymentEntity) {
        console.warn("payment.failed without payment entity");
        return;
      }

      await handlePaymentFailed(paymentEntity, eventId);
      break;
    }

    default:
      console.log(
        `Ignoring Razorpay event: ${event.event}`
      );
  }
}

async function handlePaymentCaptured(payment, eventId) {
  const razorpayPaymentId = payment.id;
  const razorpayOrderId = payment.order_id;

  if (!razorpayPaymentId || !razorpayOrderId) {
    console.warn("Captured payment missing IDs");
    return;
  }

  const order = await Order.findOne({
    razorpay_order_id: razorpayOrderId,
  });

  if (!order) {
    console.warn(
      `Order not found for Razorpay order ${razorpayOrderId}`
    );
    return;
  }

  // Idempotent payment record.
  await Payment.findOneAndUpdate(
    { razorpay_payment_id: razorpayPaymentId },
    {
      order_id: order._id,
      razorpay_payment_id: razorpayPaymentId,
      amount: payment.amount / 100,
      status: payment.status || "captured",
      method: payment.method,
      error_description: payment.error_description,
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );

  // Never downgrade an already paid order.
  if (order.payment_status !== "Paid") {
    order.payment_status = "Paid";
    order.status = "Confirmed";
    order.razorpay_payment_id = razorpayPaymentId;

    await order.save();

    console.log(
      `Order ${order._id} marked PAID via Razorpay webhook`
    );
  }
}

async function handleOrderPaid(
  payment,
  razorpayOrder,
  eventId
) {
  const razorpayOrderId = razorpayOrder?.id;

  if (!razorpayOrderId) {
    console.warn("order.paid missing Razorpay order ID");
    return;
  }

  const order = await Order.findOne({
    razorpay_order_id: razorpayOrderId,
  });

  if (!order) {
    console.warn(
      `Order not found for Razorpay order ${razorpayOrderId}`
    );
    return;
  }

  const paymentId = payment?.id;

  if (paymentId) {
    await Payment.findOneAndUpdate(
      { razorpay_payment_id: paymentId },
      {
        order_id: order._id,
        razorpay_payment_id: paymentId,
        amount: payment.amount
          ? payment.amount / 100
          : order.total_amount,
        status: payment.status || "captured",
        method: payment.method,
        error_description: payment.error_description,
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    order.razorpay_payment_id = paymentId;
  }

  if (order.payment_status !== "Paid") {
    order.payment_status = "Paid";
    order.status = "Confirmed";

    await order.save();

    console.log(
      `Order ${order._id} marked PAID via order.paid webhook`
    );
  }
}

async function handlePaymentFailed(payment, eventId) {
  const razorpayPaymentId = payment.id;
  const razorpayOrderId = payment.order_id;

  if (!razorpayPaymentId || !razorpayOrderId) {
    console.warn("Failed payment missing IDs");
    return;
  }

  const order = await Order.findOne({
    razorpay_order_id: razorpayOrderId,
  });

  if (!order) {
    console.warn(
      `Order not found for failed Razorpay order ${razorpayOrderId}`
    );
    return;
  }

  await Payment.findOneAndUpdate(
    { razorpay_payment_id: razorpayPaymentId },
    {
      order_id: order._id,
      razorpay_payment_id: razorpayPaymentId,
      amount: payment.amount
        ? payment.amount / 100
        : order.total_amount,
      status: "failed",
      method: payment.method,
      error_description: payment.error_description,
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );

  /*
   * Do not turn an already-paid order into Failed.
   */
  if (order.payment_status !== "Paid") {
    order.payment_status = "Failed";

    await order.save();

    console.log(
      `Order ${order._id} marked PAYMENT FAILED`
    );
  }
}

export default router;