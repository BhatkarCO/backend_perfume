import { GST_PERCENTAGE } from "../config/pricing.js";

/**
 * GST amount extracted FROM a GST-inclusive price.
 *
 * Example:
 * ₹220 inclusive of 18% GST
 * GST = ₹220 × 18 / 118 = ₹33.56
 */
export const calculateIncludedGST = (inclusivePrice) => {
  const price = Number(inclusivePrice) || 0;

  return Number(
    (price * (GST_PERCENTAGE / (100 + GST_PERCENTAGE))).toFixed(2),
  );
};

/**
 * Calculate final customer-facing order amount.
 *
 * IMPORTANT:
 * productPrice is already GST-inclusive.
 * GST is NOT added here.
 *
 * discount = coupon discount only.
 * productDiscount is informational only.
 */
export const calculateFinalAmount = ({
  productPrice,
  shippingCharge,
  discount = 0,
  productDiscount = 0,
  codCharge = 0,
}) => {
  const productPriceValue = Number(productPrice) || 0;
  const shippingChargeValue = Number(shippingCharge) || 0;
  const couponDiscountValue = Number(discount) || 0;
  const productDiscountValue = Number(productDiscount) || 0;
  const codChargeValue = Number(codCharge) || 0;

  // Sale price is already GST-inclusive.
  const subtotal = Number(productPriceValue.toFixed(2));

  // Coupon is the only discount actually deducted.
  const total = Number(
    (
      subtotal -
      couponDiscountValue +
      shippingChargeValue +
      codChargeValue
    ).toFixed(2),
  );

  return {
    product_price: productPriceValue,

    delivery_charge: shippingChargeValue,
    delivery_charges: shippingChargeValue,

    shippingCharge: shippingChargeValue,
    shipping_charges: shippingChargeValue,
    shipping_charge: shippingChargeValue,

    gst_percentage: GST_PERCENTAGE,

    // GST is contained inside the selling price.
    gst_amount: calculateIncludedGST(subtotal),
    gst: calculateIncludedGST(subtotal),
    tax: calculateIncludedGST(subtotal),
    taxes: calculateIncludedGST(subtotal),

    subtotal,
    total,

    // Display-only MRP discount.
    product_discount: productDiscountValue,

    // Actual deducted coupon discount.
    coupon_discount: couponDiscountValue,
    discount: couponDiscountValue,

    cod_charge: codChargeValue,

    payable: total,
    final_payable: total,
  };
};