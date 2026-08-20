import {
  getShiprocketToken,
  checkServiceability,
  SHIPROCKET_CONFIG,
} from "../config/shiprocket.js";

export const testShiprocket = async (req, res) => {
  try {
    const token = await getShiprocketToken();

    return res.status(200).json({
      success: true,
      message: "Shiprocket authenticated successfully.",
      token,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Shiprocket authentication failed.",
      error: err.response?.data || err.message,
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
    console.error(
      "Shiprocket Serviceability:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      success: false,
      message: "Unable to check serviceability.",
    });
  }
};
