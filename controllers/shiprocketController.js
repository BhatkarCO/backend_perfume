import {
  getShiprocketToken,
  checkServiceability,
  SHIPROCKET_CONFIG,
} from "../config/shiprocket.js";

export const testShiprocket = async (req, res) => {
  try {
    await getShiprocketToken();

    return res.status(200).json({
      success: true,
      message: "Shiprocket authenticated successfully.",
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Shiprocket authentication failed.",
    });
  }
};

export const getServiceability = async (req, res) => {
  try {
    const { deliveryPostcode, cod = 0 } = req.body;

    if (!deliveryPostcode) {
      return res.status(400).json({
        success: false,
        message: "Delivery postcode is required.",
      });
    }

    const response = await checkServiceability({
      pickupPostcode: SHIPROCKET_CONFIG.pickupPostcode,
      deliveryPostcode,
      cod,
      weight: SHIPROCKET_CONFIG.defaultWeight,
    });

    return res.status(200).json({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error("Shiprocket serviceability request failed.");

    return res.status(500).json({
      success: false,
      message: "Unable to check serviceability.",
    });
  }
};
