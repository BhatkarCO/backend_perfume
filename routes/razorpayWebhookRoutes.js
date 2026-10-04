import express from "express";
import crypto from "crypto";
import Order from "../models/Order.js";
import {
  captureAuthorizedPayment,
  finalizeSuccessfulPayment,
  markPaymentFailed,
} from "../services/paymentService.js";

const router = express.Router();

router.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
      const signature = req.headers["x-razorpay-signature"];
      const eventId = req.headers["x-razorpay-event-id"];

      // ----------------------------------------
      // 1. Webhook secret
      // ----------------------------------------

      if (!webhookSecret) {
        console.error("RAZORPAY_WEBHOOK_SECRET is not configured");

        return res.status(500).json({
          message: "Webhook secret is not configured.",
        });
      }

      // ----------------------------------------
      // 2. Signature must exist
      // ----------------------------------------

      if (!signature) {
        return res.status(400).json({
          message: "Missing Razorpay webhook signature.",
        });
      }

      // ----------------------------------------
      // 3. Validate raw-body HMAC signature
      // ----------------------------------------

      if (!Buffer.isBuffer(req.body)) {
        console.error("Razorpay webhook body is not a raw Buffer.");

        return res.status(400).json({
          message: "Invalid webhook body.",
        });
      }

      const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(req.body)
        .digest("hex");

      const receivedBuffer = Buffer.from(String(signature), "utf8");
      const expectedBuffer = Buffer.from(expectedSignature, "utf8");

      const signatureValid =
        receivedBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(receivedBuffer, expectedBuffer);

      if (!signatureValid) {
        console.error("Invalid Razorpay webhook signature.");

        return res.status(400).json({
          message: "Invalid webhook signature.",
        });
      }

      // ----------------------------------------
      // 4. Parse webhook payload
      // ----------------------------------------

      let event;

      try {
        event = JSON.parse(req.body.toString("utf8"));
      } catch (parseError) {
        console.error("Invalid Razorpay webhook JSON:", parseError.message);

        return res.status(400).json({
          message: "Invalid webhook payload.",
        });
      }

      const eventName = event?.event;

      console.log(
        `Razorpay webhook received: ${eventName}`,
        eventId ? `(${eventId})` : "",
      );

      // ----------------------------------------
      // 5. Handle supported events
      // ----------------------------------------

      switch (eventName) {
        case "payment.authorized":
          await handlePaymentAuthorized(event);
          break;

        case "payment.captured":
          await handlePaymentCaptured(event);
          break;

        case "payment.failed":
          await handlePaymentFailed(event);
          break;

        case "order.paid":
          /*
           * payment.captured is the event we use for
           * successful payment finalization.
           *
           * order.paid can arrive for the same payment,
           * so we intentionally do not finalize the order
           * a second time from this event.
           */
          console.log("Ignoring order.paid webhook event.");
          break;

        default:
          console.log(`Ignoring Razorpay event: ${eventName}`);
          break;
      }

      return res.status(200).json({
        success: true,
      });
    } catch (error) {
      console.error("Razorpay webhook processing error:", error.message);

      if (!res.headersSent) {
        return res.status(400).json({
          message: "Unable to process Razorpay webhook.",
        });
      }
    }
  },
);

/**
 * Capture an authorized payment only while its reserved inventory is active.
 */
async function handlePaymentAuthorized(event) {
  const payment = event?.payload?.payment?.entity;

  if (
    !payment ||
    payment.status !== "authorized" ||
    !payment.id ||
    !payment.order_id
  ) {
    console.warn("Ignoring malformed payment.authorized webhook.");
    return;
  }

  const order = await Order.findOne({
    razorpay_order_id: payment.order_id,
  });

  if (!order) {
    console.warn("Authorized payment has no matching local order.");
    return;
  }

  if (order.inventory_status === "Released") {
    console.warn("Ignoring authorization for a released reservation.");
    return;
  }

  await captureAuthorizedPayment({
    orderId: order._id,
    razorpayPaymentId: payment.id,
    razorpayOrderId: payment.order_id,
    amountPaise: Number(payment.amount),
    currency: payment.currency || "INR",
    paymentMethod: payment.method || "digital",
  });
}

/**
 * Handle successful captured payment.
 */
async function handlePaymentCaptured(event) {
  const payment = event?.payload?.payment?.entity;

  if (!payment) {
    console.warn("payment.captured webhook without payment entity.");
    return;
  }

  const razorpayPaymentId = payment.id;
  const razorpayOrderId = payment.order_id;

  if (!razorpayPaymentId || !razorpayOrderId) {
    console.warn("Captured payment is missing required IDs.");
    return;
  }

  if (payment.status !== "captured") {
    console.warn(
      `Ignoring payment.captured event with unexpected status: ${payment.status}`,
    );
    return;
  }

  // ----------------------------------------
  // Find local order
  // ----------------------------------------

  const order = await Order.findOne({
    razorpay_order_id: razorpayOrderId,
  });

  if (!order) {
    console.warn(
      `Order not found for Razorpay order ${razorpayOrderId}`,
    );
    return;
  }

  if (order.inventory_status === "Released") {
    console.error(
      `Captured payment rejected for released order ${order._id}.`,
    );
    return;
  }

  // ----------------------------------------
  // Finalize through the shared service
  // ----------------------------------------

  const result = await finalizeSuccessfulPayment({
    orderId: order._id,
    razorpayPaymentId,
    razorpayOrderId,
    amountPaise: Number(payment.amount),
    currency: payment.currency || "INR",
    paymentStatus: payment.status,
    paymentMethod: payment.method || "digital",
  });

  if (result?.alreadyFinalized) {
    console.log(`Payment already finalized for order ${order._id}`);
    return;
  }

  console.log(
    `Order ${order._id} finalized as PAID via Razorpay webhook`,
  );
}

/**
 * Handle failed Razorpay payment.
 */
async function handlePaymentFailed(event) {
  const payment = event?.payload?.payment?.entity;

  if (!payment) {
    console.warn("payment.failed webhook without payment entity.");
    return;
  }

  const razorpayPaymentId = payment.id;
  const razorpayOrderId = payment.order_id;

  if (!razorpayPaymentId || !razorpayOrderId) {
    console.warn("Failed payment is missing required IDs.");
    return;
  }

  const order = await Order.findOne({
    razorpay_order_id: razorpayOrderId,
  });

  if (!order) {
    console.warn(
      `Order not found for failed Razorpay order ${razorpayOrderId}`,
    );
    return;
  }

  const result = await markPaymentFailed({
    orderId: order._id,
    razorpayPaymentId,
    razorpayOrderId,
    amountPaise: Number(payment.amount),
    paymentMethod: payment.method || "digital",
    errorDescription: payment.error_description || null,
  });

  if (result?.alreadyPaid) {
    console.log(
      `Ignoring failed webhook because order ${order._id} is already PAID`,
    );
    return;
  }

  console.log(
    `Order ${order._id} marked PAYMENT FAILED via Razorpay webhook`,
  );
}

export default router;