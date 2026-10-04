import Order from "../models/Order.js";
import crypto from "crypto";
import mongoose from "mongoose";

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};

// ----------------------------------------
// Convert Shiprocket status → our DB status
// ----------------------------------------
const normalizeShiprocketStatus = (status, statusId) => {
  const numericStatusId = Number(statusId);

  const statusIdMap = {
    1: "AWB_ASSIGNED",
    3: "PICKUP_SCHEDULED",

    // Shiprocket webhook:
    // current_status_id = 5 when current_status = CANCELED
    5: "CANCELLED",

    6: "IN_TRANSIT",
    7: "DELIVERED",
    8: "CANCELLED",
    9: "RTO",
    10: "RTO_DELIVERED",
    12: "LOST",
    17: "OUT_FOR_DELIVERY",
    18: "IN_TRANSIT",
    42: "PICKED_UP",
    45: "CANCELLED",
  };

  if (statusIdMap[numericStatusId]) {
    return statusIdMap[numericStatusId];
  }

  if (!status) return null;

  const normalized = String(status)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  const statusMap = {
    AWB_ASSIGNED: "AWB_ASSIGNED",
    AWB_ASSIGNMENT: "AWB_ASSIGNED",

    PICKUP_SCHEDULED: "PICKUP_SCHEDULED",
    PICKUP_GENERATED: "PICKUP_SCHEDULED",

    PICKED_UP: "PICKED_UP",
    PICKEDUP: "PICKED_UP",

    SHIPPED: "IN_TRANSIT",
    IN_TRANSIT: "IN_TRANSIT",

    OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
    OUTFORDELIVERY: "OUT_FOR_DELIVERY",

    DELIVERED: "DELIVERED",

    CANCELLED: "CANCELLED",
    CANCELED: "CANCELLED",
    CANCELLED_BEFORE_DISPATCHED: "CANCELLED",

    RTO: "RTO",
    RTO_INITIATED: "RTO",
    RTO_DELIVERED: "RTO_DELIVERED",

    LOST: "LOST",
  };

  return statusMap[normalized] || null;
};

// ----------------------------------------
// Status priority
// Prevent older webhook events from
// overwriting newer shipment status
// ----------------------------------------
const statusPriority = {
  AWB_ASSIGNED: 1,
  PICKUP_SCHEDULED: 2,
  PICKED_UP: 3,
  IN_TRANSIT: 4,
  OUT_FOR_DELIVERY: 5,
  DELIVERED: 6,

  CANCELLED: 7,
  RTO: 7,
  RTO_DELIVERED: 8,
  LOST: 9,
};

// ----------------------------------------
// Shiprocket Webhook
// ----------------------------------------
export const handleShiprocketWebhook = async (req, res) => {
  try {
    const payload = req.body;

    // ----------------------------------------
    // Verify Shiprocket webhook token
    // ----------------------------------------
    const receivedToken = req.headers["x-api-key"];
    const expectedToken = process.env.SHIPROCKET_WEBHOOK_TOKEN;

    const receivedBuffer = Buffer.from(String(receivedToken || ""));

    const expectedBuffer = Buffer.from(String(expectedToken || ""));

    const tokenValid =
      expectedBuffer.length > 0 &&
      receivedBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(receivedBuffer, expectedBuffer);

    if (!tokenValid) {
      console.warn("Invalid Shiprocket webhook token");

      return res.status(401).json({
        received: false,
        updated: false,
        message: "Unauthorized",
      });
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return res.status(400).json({
        received: false,
        updated: false,
        message: "Invalid webhook payload.",
      });
    }

    const eventHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(canonicalize(payload)))
      .digest("hex");

    // ----------------------------------------
    // Extract AWB
    // ----------------------------------------
    const awb =
      payload?.awb ??
      payload?.awb_code ??
      payload?.shipment?.awb ??
      payload?.data?.awb ??
      payload?.data?.awb_code ??
      null;

    // ----------------------------------------
    // Extract Shipment ID
    // ----------------------------------------
    const shipmentId =
      payload?.shipment_id ??
      payload?.shipment?.shipment_id ??
      payload?.data?.shipment_id ??
      null;

    // ----------------------------------------
    // Extract Shiprocket Order ID
    // ----------------------------------------
    const shiprocketOrderId =
      payload?.sr_order_id ??
      payload?.order_id ??
      payload?.shiprocket_order_id ??
      payload?.data?.sr_order_id ??
      payload?.data?.order_id ??
      payload?.data?.shiprocket_order_id ??
      null;

    // ----------------------------------------
    // Extract Status
    // ----------------------------------------
    const rawStatus =
      payload?.current_status ??
      payload?.status ??
      payload?.shipment_status ??
      payload?.data?.current_status ??
      payload?.data?.status ??
      payload?.data?.shipment_status ??
      null;

    // ----------------------------------------
    // Extract Status ID
    // ----------------------------------------
    const rawStatusId =
      payload?.current_status_id ??
      payload?.shipment_status_id ??
      payload?.status_id ??
      payload?.data?.current_status_id ??
      payload?.data?.shipment_status_id ??
      payload?.data?.status_id ??
      null;

    // ----------------------------------------
    // Normalize status
    // ----------------------------------------
    const normalizedStatus = normalizeShiprocketStatus(rawStatus, rawStatusId);

    // ----------------------------------------
    // Validate identifiers
    // ----------------------------------------
    if (!awb && !shipmentId && !shiprocketOrderId) {
      console.warn(
        "Shiprocket webhook missing AWB, shipment ID, and Shiprocket order ID",
      );

      return res.status(200).json({
        received: true,
        updated: false,
      });
    }

    const conditions = [];
    if (awb) conditions.push({ shiprocket_awb: String(awb) });
    if (shipmentId) {
      const parsedShipmentId = Number(shipmentId);
      if (Number.isFinite(parsedShipmentId)) {
        conditions.push({ shiprocket_shipment_id: parsedShipmentId });
      }
    }
    if (shiprocketOrderId) {
      conditions.push({ shiprocket_order_id: String(shiprocketOrderId) });
    }

    const session = await mongoose.startSession();
    let order = null;
    try {
      if (conditions.length === 0) {
        return res.status(200).json({ received: true, updated: false });
      }

      await session.withTransaction(async () => {
        order = await Order.findOne({ $or: conditions }).session(session);
        if (!order) return;

        await mongoose.connection
          .collection("shiprocket_webhook_events")
          .insertOne(
            { _id: eventHash, processed_at: new Date() },
            { session },
          );

        if (awb) order.shiprocket_awb = String(awb);
        if (shipmentId && Number.isFinite(Number(shipmentId))) {
          order.shiprocket_shipment_id = Number(shipmentId);
        }
        if (shiprocketOrderId) {
          order.shiprocket_order_id = String(shiprocketOrderId);
        }

        if (normalizedStatus) {
          const currentStatus = order.shiprocket_status;
          const currentPriority = statusPriority[currentStatus] || 0;
          const newPriority = statusPriority[normalizedStatus] || 0;

          if (newPriority >= currentPriority) {
            order.shiprocket_status = normalizedStatus;
          } else {
            console.warn(
              `Ignoring status "${normalizedStatus}" because order is already "${order.shiprocket_status}"`,
            );
          }
        }

        await order.save({ session });
      });
    } finally {
      await session.endSession();
    }

    if (!order) {
      console.warn("No local order found for Shiprocket webhook.");
      return res.status(200).json({ received: true, updated: false });
    }

    console.log("Shiprocket webhook processed.", {
      orderId: order._id,
      status: order.shiprocket_status,
    });

    // ----------------------------------------
    // Response
    // ----------------------------------------
    return res.status(200).json({
      received: true,
      updated: true,
      status: order.shiprocket_status,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(200).json({
        received: true,
        updated: false,
        duplicate: true,
      });
    }

    console.error(
      "Shiprocket webhook processing failed.",
    );

    return res.status(200).json({
      received: true,
      updated: false,
    });
  }
};
