import PDFDocument from "pdfkit";

/**
 * Shared drawing logic for invoice PDF
 */
export const drawInvoicePDF = (doc, order, items) => {
  // Styling Colors
  const GOLD = "#D4AF37";
  const DARK = "#121212";
  const GREY = "#555555";

  // Header / Brand Logo
  doc
    .fillColor(GOLD)
    .fontSize(26)
    .font("Helvetica-Bold")
    .text("BHATKAR CO PERFUMES", 50, 45)
    .fontSize(10)
    .fillColor(DARK)
    .text("HOUSE OF PREMIUM LUXURY PERFUMES", 50, 75)
    .font("Helvetica")
    .fillColor(GREY)
    .text("Web: www.bhatkarco.com", 50, 90)
    .text("Support: support@bhatkarco.com", 50, 102);

  // Invoice Meta
  // Invoice Meta
  const metaX = 340;
  const metaWidth = 210;
  let metaY = 45;

  doc
    .fillColor(DARK)
    .font("Helvetica-Bold")
    .fontSize(16)
    .text("INVOICE", metaX, metaY, {
      width: metaWidth,
      align: "right",
    });

  metaY += 28;

  doc.font("Helvetica").fontSize(10).fillColor(GREY);

  doc.text(`Invoice ID: #INV-${order.id}`, metaX, metaY, {
    width: metaWidth,
    align: "right",
  });

  metaY += 16;

  doc.text(`Order ID: #${order.id}`, metaX, metaY, {
    width: metaWidth,
    align: "right",
  });

  metaY += 16;

  doc.text(
    `Date: ${new Date(order.created_at).toLocaleDateString("en-IN")}`,
    metaX,
    metaY,
    {
      width: metaWidth,
      align: "right",
    },
  );

  metaY += 16;

  doc.text(`Status: ${order.status.toUpperCase()}`, metaX, metaY, {
    width: metaWidth,
    align: "right",
  });

  // Horizontal divider line
  doc
    .moveTo(50, 130)
    .lineTo(550, 130)
    .strokeColor("#E0E0E0")
    .lineWidth(1)
    .stroke();

  // Billing & Shipping Info
  doc
    .fillColor(DARK)
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("BILL & SHIP TO:", 50, 150)
    .font("Helvetica")
    .fontSize(10)
    .fillColor(GREY)
    .text(order.customer_name, 50, 168)
    .text(order.customer_email, 50, 180)
    .text(`${order.address_line1}, ${order.address_line2 || ""}`, 50, 192)
    .text(`${order.city}, ${order.state} - ${order.postal_code}`, 50, 204)
    .text(`Phone: ${order.shipping_phone}`, 50, 216);

  // Payment info box
  doc
    .rect(350, 150, 200, 80)
    .fillColor("#F9F9F9")
    .fill()
    .strokeColor("#D4AF37")
    .lineWidth(0.5)
    .stroke();

  doc
    .fillColor(DARK)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("PAYMENT DETAILS", 360, 160)
    .font("Helvetica")
    .fillColor(GREY);

  if (order.payment_method === "COD") {
    doc
      .text("Payment Method:", 360, 178)
      .text("Cash on Delivery (COD)", 360, 190)
      .text(`Payment Status: ${order.payment_status}`, 360, 205)
      .text("Payment ID: N/A", 360, 220);
  } else {
    doc
      .text("Payment Method:", 360, 178)
      .text("Razorpay", 360, 190)
      .text(`Payment Status: ${order.payment_status}`, 360, 205)
      .fontSize(8)
      .text(`Payment ID: ${order.razorpay_payment_id || "N/A"}`, 360, 220);
  }

  // Table Header
  let tableY = 260;
  doc.rect(50, tableY, 500, 22).fillColor(DARK).fill();

  doc
    .fillColor("#FFFFFF")
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("S.No", 60, tableY + 6)
    .text("Item Description", 100, tableY + 6)
    .text("Price", 340, tableY + 6, { width: 60, align: "right" })
    .text("Qty", 420, tableY + 6, { width: 40, align: "right" })
    .text("Total (INR)", 480, tableY + 6, { width: 60, align: "right" });

  // Table Rows
  let itemY = tableY + 22;
  doc.font("Helvetica").fillColor(DARK);

  items.forEach((item, index) => {
    const itemTotal = parseFloat(item.price_at_purchase) * item.quantity;
    doc
      .text(`${index + 1}`, 60, itemY + 6)
      .text(item.name, 100, itemY + 6, { width: 230 })
      .text(
        `₹${parseFloat(item.price_at_purchase).toFixed(2)}`,
        340,
        itemY + 6,
        { width: 60, align: "right" },
      )
      .text(`${item.quantity}`, 420, itemY + 6, { width: 40, align: "right" })
      .text(`₹${itemTotal.toFixed(2)}`, 480, itemY + 6, {
        width: 60,
        align: "right",
      });

    itemY += 22;
    // Draw bottom line
    doc.moveTo(50, itemY).lineTo(550, itemY).strokeColor("#F0F0F0").stroke();
  });

  // ===============================
  // INVOICE SUMMARY
  // ===============================

  const pricing = order.pricing || {};

  const subtotal = Number(
    pricing.product_price ??
      items.reduce(
        (sum, item) =>
          sum +
          Number(item.price_at_purchase || 0) * Number(item.quantity || 0),
        0,
      ),
  );

  const gst = Number(pricing.gst_amount ?? pricing.gst ?? 0);

  const shipping = Number(
    pricing.delivery_charges ??
      pricing.delivery_charge ??
      pricing.shippingCharge ??
      pricing.shipping_charges ??
      pricing.shipping_charge ??
      0,
  );

  const discount = Number(pricing.discount ?? order.discount_amount ?? 0);

  const total = Number(
    order.total_amount ??
      pricing.payable ??
      subtotal + gst + shipping - discount,
  );

  // Subtotal
  itemY += 15;

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(GREY)
    .text("Subtotal:", 380, itemY)
    .text(`₹${subtotal.toFixed(2)}`, 480, itemY, {
      align: "right",
    });

  // GST
  itemY += 15;

  doc
    .text(`GST / Tax (${pricing.gst_percentage ?? 18}%):`, 330, itemY, {
      width: 140,
      align: "right",
    })
    .text(`₹${gst.toFixed(2)}`, 480, itemY, {
      align: "right",
    });

  // Discount
  if (discount > 0) {
    itemY += 15;

    doc
      .text(`Discount (${order.coupon_code || "Coupon"}):`, 330, itemY, {
        width: 140,
        align: "right",
      })
      .text(`- ₹${discount.toFixed(2)}`, 480, itemY, {
        align: "right",
      });
  }

  // Shipping
  itemY += 15;

  doc
    .text("Shipping:", 380, itemY)
    .text(shipping > 0 ? `₹${shipping.toFixed(2)}` : "FREE", 480, itemY, {
      align: "right",
    });

  // Divider
  itemY += 20;

  doc.moveTo(350, itemY).lineTo(550, itemY).strokeColor("#E0E0E0").stroke();

  // Grand Total
  itemY += 10;

  doc
    .fillColor(GOLD)
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("Grand Total:", 360, itemY)
    .text(`₹${total.toFixed(2)}`, 480, itemY, {
      align: "right",
    });

  // Footer Thank you
  doc
    .fillColor(GREY)
    .fontSize(10)
    .font("Helvetica-Oblique")
    .text(
      "Thank you for choosing Bhatkar Perfumes. Keep smelling magnificent!",
      50,
      700,
      { align: "center" },
    );

  doc.end();
};
