import { GST_PERCENTAGE } from "../config/pricing.js";

export const calculateGST = (productPrice) => {
  const price = Number(productPrice) || 0;

  return Number((price * (GST_PERCENTAGE / 100)).toFixed(2));
};

export const calculateFinalAmount = ({
  productPrice,
  shippingCharge,
  discount = 0,
}) => {
  const productPriceValue = Number(productPrice) || 0;
  const shippingChargeValue = Number(shippingCharge) || 0;
  const discountValue = Number(discount) || 0;

  const gst = calculateGST(productPriceValue);

  const subtotal = productPriceValue + shippingChargeValue;

  const total = subtotal + gst;

  const payable = Math.max(0, total - discountValue);

  return {
    product_price: productPriceValue,

    delivery_charge: shippingChargeValue,
    delivery_charges: shippingChargeValue,

    shippingCharge: shippingChargeValue,
    shipping_charges: shippingChargeValue,
    shipping_charge: shippingChargeValue,

    gst_percentage: GST_PERCENTAGE,
    gst_amount: gst,

    gst,
    tax: gst,
    taxes: gst,

    subtotal,
    total,
    discount: discountValue,
    payable,
  };
};
