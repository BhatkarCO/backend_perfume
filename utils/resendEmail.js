import { Resend } from "resend";
import PDFDocument from "pdfkit";
import { drawInvoicePDF } from "./invoicePDF.js";

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Generates the invoice PDF into a Buffer in memory
 */
const generateInvoiceBuffer = (order, items) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err) => reject(err));

      drawInvoicePDF(doc, order, items);
    } catch (err) {
      reject(err);
    }
  });
};

/**
 * Sends order invoice via Resend email service
 */
export const sendInvoiceEmail = async (order, items) => {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.EMAIL_FROM || "noreply@bhatkarco.com";

  if (!apiKey) {
    console.warn(
      "RESEND_API_KEY not configured. Skipping automated invoice email.",
    );
    return false;
  }

  try {
    const to = order.customer_email || order.email;
    if (!to) {
      console.error("No recipient email found for order", order.id);
      return false;
    }

    console.log(`Generating invoice PDF buffer for order #${order.id}...`);
    const pdfBuffer = await generateInvoiceBuffer(order, items);

    const subject = `Your Bhatkar Perfumes Order Invoice - #${order.id}`;

    // Order Summary items bullet points
    const itemsHtml = items
      .map(
        (item) => `
      <li>
        <strong>${item.name}</strong> x ${item.quantity} - ₹${parseFloat(item.price_at_purchase).toFixed(2)}
      </li>
    `,
      )
      .join("");

    const orderDate = new Date(
      order.created_at || new Date(),
    ).toLocaleDateString("en-IN");

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #121212; border: 1px solid #e5e7eb; border-top: 4px solid #D4AF37; padding: 24px; border-radius: 4px;">
        <h2 style="color: #D4AF37; margin-bottom: 20px; font-family: 'Georgia', serif;">Thank You for Your Order!</h2>
        <p>Dear ${order.customer_name || "Valued Customer"},</p>
        <p>Your order has been successfully placed. We are preparing it with the utmost care.</p>
        
        <div style="background-color: #f9fafb; border: 1px solid #f3f4f6; padding: 16px; margin: 20px 0; border-radius: 4px;">
          <h3 style="margin-top: 0; color: #121212; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px;">Order Details</h3>
          <p style="margin: 4px 0;"><strong>Order Number:</strong> #${order.id}</p>
          <p style="margin: 4px 0;"><strong>Order Date:</strong> ${orderDate}</p>
          <p style="margin: 4px 0;"><strong>Total Amount:</strong> ₹${parseFloat(order.total_amount).toFixed(2)}</p>
        </div>

        <h3 style="color: #121212; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-top: 24px;">Items Ordered</h3>
        <ul style="padding-left: 20px; line-height: 1.6;">
          ${itemsHtml}
        </ul>

        <p style="margin-top: 24px;">Your official tax invoice is attached to this email as a PDF.</p>
        <p>If you have any questions or require support, please contact us at <a href="mailto:support@bhatkar-perfumes.com" style="color: #D4AF37; text-decoration: none;">support@bhatkar-perfumes.com</a>.</p>
        
        <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 30px 0;" />
        <p style="font-size: 12px; color: #6b7280; text-align: center; font-style: italic;">
          Keep smelling magnificent!<br />
          <strong>Bhatkar & Co. Perfumes</strong>
        </p>
      </div>
    `;

    console.log(`Sending invoice email to ${to} via Resend...`);
    const response = await resend.emails.send({
      from: fromEmail,
      to: to,
      subject: subject,
      html: htmlContent,
      attachments: [
        {
          filename: `Invoice_Bhatkar_${order.id}.pdf`,
          content: pdfBuffer,
        },
      ],
    });

    //console.log("Resend email response:", response);
    return true;
  } catch (error) {
    console.error("Resend email delivery failed:", error);
    return false;
  }
};

/**
 * Sends OTP verification email via Resend email service
 */
export const sendOTPEmail = async (email, otp) => {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.EMAIL_FROM || "noreply@bhatkar-perfumes.com";

  if (!apiKey) {
    console.warn(
      "RESEND_API_KEY not configured. Skipping automated OTP email.",
    );
    console.log(`[Resend simulation] To: ${email}, OTP: ${otp}`);
    return true; // Return true as simulation success
  }

  try {
    const subject = "Your Verification Code";
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #121212; border: 1px solid #e5e7eb; border-top: 4px solid #D4AF37; padding: 24px; border-radius: 4px;">
        <h2 style="color: #D4AF37; margin-bottom: 20px; font-family: 'Georgia', serif;">Hello,</h2>
        <p>Your verification code is:</p>
        <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; padding: 16px; margin: 20px 0; border-radius: 4px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #D4AF37;">
          ${otp}
        </div>
        <p>This code is valid for 10 minutes.</p>
        <p style="margin-top: 24px; font-size: 13px; color: #6b7280;">If you did not request this, please ignore this email.</p>
        <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 30px 0;" />
        <p style="font-size: 12px; color: #6b7280; text-align: center; font-style: italic;">
          Keep smelling magnificent!<br />
          <strong>Bhatkar & Co. Perfumes</strong>
        </p>
      </div>
    `;

    console.log(`Sending OTP email to ${email} via Resend...`);
    const response = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: subject,
      html: htmlContent,
    });

    //console.log("Resend OTP email response:", response);
    return true;
  } catch (error) {
    console.error("Resend OTP email delivery failed:", error);
    return false;
  }
};
