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

  const subtotal = Number((productPriceValue + shippingChargeValue).toFixed(2));

  const total = Number((subtotal + gst).toFixed(2));

  const payable = Number(Math.max(0, total - discountValue).toFixed(2));

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
