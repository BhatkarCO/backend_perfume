import axios from "axios";

const SHIPROCKET_BASE_URL = "https://apiv2.shiprocket.in/v1/external";
const SHIPROCKET_INVOICE_HOSTS = new Set([
  "apiv2.shiprocket.in",
  "kr-shiprocket.s3.amazonaws.com",
  "sr-core-cdn.shiprocket.in",
]);
const MAX_INVOICE_BYTES = 10 * 1024 * 1024;

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

    return shiprocketToken;
  } catch (error) {
    console.error("Shiprocket authentication failed.");
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

export const downloadShiprocketInvoice = async (invoiceUrl) => {
  let parsedUrl;
  try {
    parsedUrl = new URL(invoiceUrl);
  } catch {
    throw new Error("Invalid Shiprocket invoice URL.");
  }

  if (
    parsedUrl.protocol !== "https:" ||
    !SHIPROCKET_INVOICE_HOSTS.has(parsedUrl.hostname.toLowerCase()) ||
    parsedUrl.username ||
    parsedUrl.password ||
    (parsedUrl.port && parsedUrl.port !== "443")
  ) {
    throw new Error("Untrusted Shiprocket invoice URL.");
  }

  const response = await axios.get(parsedUrl.href, {
    responseType: "arraybuffer",
    timeout: 10000,
    maxRedirects: 0,
    maxContentLength: MAX_INVOICE_BYTES,
    maxBodyLength: MAX_INVOICE_BYTES,
    headers: { Accept: "application/pdf" },
  });

  const contentType = String(response.headers?.["content-type"] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const pdfBuffer = Buffer.from(response.data);

  if (
    !["application/pdf", "application/octet-stream", "text/pdf"].includes(
      contentType,
    ) ||
    pdfBuffer.length === 0 ||
    pdfBuffer.length > MAX_INVOICE_BYTES ||
    pdfBuffer.subarray(0, 5).toString("ascii") !== "%PDF-"
  ) {
    throw new Error("Invalid Shiprocket invoice response.");
  }

  return pdfBuffer;
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
