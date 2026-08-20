import axios from "axios";

const SHIPROCKET_BASE_URL = "https://apiv2.shiprocket.in/v1/external";

let shiprocketToken = null;
let tokenExpiry = null;

export const getShiprocketToken = async () => {
  if (shiprocketToken && tokenExpiry && new Date() < tokenExpiry) {
    return shiprocketToken;
  }

  try {
    const { data } = await axios.post(`${SHIPROCKET_BASE_URL}/auth/login`, {
      email: process.env.SHIPROCKET_EMAIL,
      password: process.env.SHIPROCKET_PASSWORD,
    });

    shiprocketToken = data.token;
    tokenExpiry = new Date(Date.now() + 239 * 60 * 60 * 1000);

    console.log("✅ Shiprocket authenticated successfully");
    return shiprocketToken;
  } catch (error) {
    console.error(
      "❌ Shiprocket Login Failed:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

export const checkServiceability = async ({
  pickupPostcode,
  deliveryPostcode,
  cod,
  weight = 0.5,
}) => {
  const token = await getShiprocketToken();
  const { data } = await axios.get(
    `${SHIPROCKET_BASE_URL}/courier/serviceability`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      params: {
        pickup_postcode: pickupPostcode,
        delivery_postcode: deliveryPostcode,
        cod,
        weight,
      },
    },
  );

  return data;
};

export const createShiprocketOrder = async (payload) => {
  const token = await getShiprocketToken();
  const { data } = await axios.post(
    `${SHIPROCKET_BASE_URL}/orders/create/adhoc`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return data;
};

export const getShiprocketTracking = async (awbCode) => {
  const token = await getShiprocketToken();

  const { data } = await axios.get(
    `${SHIPROCKET_BASE_URL}/courier/track/awb/${encodeURIComponent(awbCode)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return data;
};

export const generateShiprocketInvoice = async (shiprocketOrderId) => {
  const token = await getShiprocketToken();

  const { data } = await axios.post(
    `${SHIPROCKET_BASE_URL}/orders/print/invoice`,
    {
      ids: [Number(shiprocketOrderId)],
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );

  return data;
};

export const assignShiprocketAwb = async ({ shipment_id, courier_id }) => {
  const token = await getShiprocketToken();
  const { data } = await axios.post(
    `${SHIPROCKET_BASE_URL}/courier/assign/awb`,
    { shipment_id, courier_id },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return data;
};

export const generateShiprocketPickup = async ({ shipment_id }) => {
  const token = await getShiprocketToken();
  const { data } = await axios.post(
    `${SHIPROCKET_BASE_URL}/courier/generate/pickup`,
    { shipment_id },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return data;
};

export const SHIPROCKET_CONFIG = {
  pickupPostcode: process.env.SHIPROCKET_PICKUP_PIN || "400710",
  pickupLocation: process.env.SHIPROCKET_PICKUP_LOCATION || "Primary",
  defaultWeight: 0.5,
  defaultDimensions: {
    length: 10,
    breadth: 10,
    height: 10,
  },
};
