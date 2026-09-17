import Order from "../models/Order.js";

// ----------------------------------------
// Convert Shiprocket status → our DB status
// ----------------------------------------
const normalizeShiprocketStatus = (status, statusId) => {
  const numericStatusId = Number(statusId);

  const statusIdMap = {
    1: "AWB_ASSIGNED",
    3: "PICKUP_SCHEDULED",
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
    // ----------------------------------------
    // Verify Shiprocket webhook token
    // ----------------------------------------
    console.log("SHIPROCKET WEBHOOK:", JSON.stringify(req.body, null, 2));
    console.log("Shiprocket status:", {
      rawStatus,
      rawStatusId,
      normalizedStatus,
    });

    const receivedToken = req.headers["x-api-key"];
    const expectedToken = process.env.SHIPROCKET_WEBHOOK_TOKEN;

    if (!expectedToken || receivedToken !== expectedToken) {
      console.warn("Invalid Shiprocket webhook token");

      return res.status(401).json({
        received: false,
        updated: false,
        message: "Unauthorized",
      });
    }

    const payload = req.body;

    // ----------------------------------------
    // Extract AWB
    // ----------------------------------------

    const awb =
      payload?.awb ||
      payload?.awb_code ||
      payload?.shipment?.awb ||
      payload?.data?.awb ||
      payload?.data?.awb_code ||
      null;

    // ----------------------------------------
    // Extract Shipment ID
    // ----------------------------------------

    const shipmentId =
      payload?.shipment_id ||
      payload?.shipment?.shipment_id ||
      payload?.data?.shipment_id ||
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

    const rawStatusId =
      payload?.current_status_id ??
      payload?.shipment_status_id ??
      payload?.data?.current_status_id ??
      payload?.data?.shipment_status_id ??
      null;

    const normalizedStatus = normalizeShiprocketStatus(rawStatus, rawStatusId);

    // ----------------------------------------
    // Validate identifiers
    // ----------------------------------------

    if (!awb && !shipmentId && !shiprocketOrderId) {
      console.warn("Shiprocket webhook missing AWB and shipment ID");

      return res.status(200).json({
        received: true,
        updated: false,
      });
    }

    if (!order && shiprocketOrderId) {
      order = await Order.findOne({
        shiprocket_order_id: String(shiprocketOrderId),
      });
    }
    // ----------------------------------------
    // Find local order
    // ----------------------------------------

    let order = null;

    // First try AWB
    if (awb) {
      order = await Order.findOne({
        shiprocket_awb: String(awb),
      });
    }

    // If not found, try shipment ID
    if (!order && shipmentId) {
      order = await Order.findOne({
        shiprocket_shipment_id: Number(shipmentId),
      });
    }

    // ----------------------------------------
    // Order not found
    // ----------------------------------------

    if (!order) {
      console.warn("No local order found for Shiprocket webhook:", {
        awb,
        shipmentId,
      });

      return res.status(200).json({
        received: true,
        updated: false,
      });
    }

    // ----------------------------------------
    // Update Shiprocket information
    // ----------------------------------------

    if (awb) {
      order.shiprocket_awb = String(awb);
    }

    if (shipmentId) {
      order.shiprocket_shipment_id = Number(shipmentId);
    }

    // ----------------------------------------
    // Update status
    // ----------------------------------------

    if (normalizedStatus) {
      const currentStatus = order.shiprocket_status;

      const currentPriority = statusPriority[currentStatus] || 0;

      const newPriority = statusPriority[normalizedStatus] || 0;

      // Only update if this is not an older status
      if (newPriority >= currentPriority) {
        order.shiprocket_status = normalizedStatus;

        console.log(
          `Status updated: ${currentStatus || "NONE"} → ${normalizedStatus}`,
        );
      } else {
        console.warn(
          `Ignoring status "${normalizedStatus}" because order is already "${order.shiprocket_status}"`,
        );
      }
    } else {
      console.warn(`Unknown Shiprocket status received: "${rawStatus}"`);
    }

    // ----------------------------------------
    // Save order
    // ----------------------------------------

    await order.save();

    // ----------------------------------------
    // Response
    // ----------------------------------------

    return res.status(200).json({
      received: true,
      updated: true,
      status: order.shiprocket_status,
    });
  } catch (error) {
    console.error(
      "Shiprocket webhook error:",
      error.response?.data || error.message,
    );

    // Acknowledge webhook
    return res.status(200).json({
      received: true,
      updated: false,
    });
  }
};
