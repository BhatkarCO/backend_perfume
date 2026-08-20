import Order from "../models/Order.js";

// Convert Shiprocket status → our database status
const normalizeShiprocketStatus = (status) => {
  if (!status) return null;

  const normalized = String(status)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  const statusMap = {
    // AWB / assignment
    AWB_ASSIGNED: "AWB_ASSIGNED",
    AWB_ASSIGNMENT: "AWB_ASSIGNED",

    // Pickup
    PICKUP_SCHEDULED: "PICKUP_SCHEDULED",
    PICKUP_GENERATED: "PICKUP_SCHEDULED",

    // Shipment movement
    PICKED_UP: "PICKED_UP",
    PICKEDUP: "PICKED_UP",

    SHIPPED: "IN_TRANSIT",
    IN_TRANSIT: "IN_TRANSIT",

    OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
    OUTFORDELIVERY: "OUT_FOR_DELIVERY",

    DELIVERED: "DELIVERED",

    // Failed / cancelled
    CANCELLED: "CANCELLED",
    CANCELED: "CANCELLED",

    RTO: "RTO",
    RTO_INITIATED: "RTO",

    RTO_DELIVERED: "RTO_DELIVERED",

    LOST: "LOST",
  };

  return statusMap[normalized] || null;
};

export const handleShiprocketWebhook = async (req, res) => {
  try {
    console.log("========== SHIPROCKET WEBHOOK ==========");
    console.log(JSON.stringify(req.body, null, 2));

    const payload = req.body;

    const awb =
      payload?.awb ||
      payload?.awb_code ||
      payload?.shipment?.awb ||
      payload?.data?.awb ||
      payload?.data?.awb_code ||
      null;

    const shipmentId =
      payload?.shipment_id ||
      payload?.shipment?.shipment_id ||
      payload?.data?.shipment_id ||
      null;

    const rawStatus =
      payload?.current_status ||
      payload?.status ||
      payload?.shipment_status ||
      payload?.data?.status ||
      null;

    const normalizedStatus = normalizeShiprocketStatus(rawStatus);

    console.log("Shiprocket status:", rawStatus);
    console.log("Normalized status:", normalizedStatus);

    if (!awb && !shipmentId) {
      console.warn("Shiprocket webhook missing AWB and shipment ID");

      return res.status(200).json({
        received: true,
        updated: false,
      });
    }

    // ----------------------------------------
    // Find local order
    // ----------------------------------------

    let order = null;

    if (awb) {
      order = await Order.findOne({
        shiprocket_awb: String(awb),
      });
    }

    if (!order && shipmentId) {
      order = await Order.findOne({
        shiprocket_shipment_id: Number(shipmentId),
      });
    }

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

    // Only save status if we know how to map it
    if (normalizedStatus) {
      order.shiprocket_status = normalizedStatus;
    } else {
      console.warn(`Unknown Shiprocket status received: "${rawStatus}"`);
    }

    await order.save();

    console.log("========== SHIPROCKET ORDER UPDATED ==========");

    console.log({
      orderId: order.id,
      shiprocketOrderId: order.shiprocket_order_id,
      shiprocketShipmentId: order.shiprocket_shipment_id,
      awb: order.shiprocket_awb,
      rawStatus,
      normalizedStatus,
    });

    return res.status(200).json({
      received: true,
      updated: true,
      status: normalizedStatus,
    });
  } catch (error) {
    console.error(
      "Shiprocket webhook error:",
      error.response?.data || error.message,
    );

    // Always acknowledge webhook
    return res.status(200).json({
      received: true,
      updated: false,
    });
  }
};
