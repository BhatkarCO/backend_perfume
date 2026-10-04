import { Resend } from "resend";
import {
  downloadShiprocketInvoice,
  generateShiprocketInvoice,
} from "../config/shiprocket.js";

const getResendClient = () => {
  const apiKey = process.env.RESEND_API_KEY;
  return apiKey ? new Resend(apiKey) : null;
};

// TEMPORARY: Remove after invoice delivery diagnosis is complete.
const logInvoiceDiagnostic = (message) => {
  if (process.env.NODE_ENV === "development") {
    console.info(`[RESEND] ${message}`);
  }
};

const sanitizeDiagnosticMessage = (error) => {
  const message =
    typeof error?.message === "string" ? error.message : "Unknown error";

  return message
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email redacted]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone redacted]")
    .replace(/https?:\/\/\S+/gi, "[URL redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bre_[A-Za-z0-9_-]+\b/g, "[API key redacted]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[token redacted]")
    .slice(0, 240);
};

const getSafeStatusCode = (error) => {
  const statusCode =
    error?.statusCode ?? error?.status ?? error?.response?.status;
  return Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
    ? statusCode
    : "unavailable";
};

export const sendResendEmail = async ({
  to,
  subject,
  text,
  html,
}) => {
  const resend = getResendClient();

  if (!resend) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const result = await resend.emails.send({
    from: process.env.EMAIL_FROM || "noreply@bhatkar-perfumes.com",
    to,
    subject,
    text,
    html,
  });

  if (result?.error) {
    throw new Error("Resend email delivery failed.");
  }

  return result;
};

/**
 * Sends order invoice via Resend email service
 */
export const sendInvoiceEmail = async (order, items) => {
  const apiKey = process.env.RESEND_API_KEY;
  const resend = getResendClient();
  const fromEmail = process.env.EMAIL_FROM || "noreply@bhatkarco.com";

  if (!apiKey || !resend) {
    console.warn(
      "RESEND_API_KEY not configured. Skipping automated invoice email.",
    );
    return false;
  }

  let stage = "validating invoice prerequisites";
  try {
    const to = order.customer_email || order.email;
    if (!to) {
      logInvoiceDiagnostic(
        "stage failed: validating invoice prerequisites; status=unavailable; message=Invoice recipient is missing",
      );
      console.error("No recipient email found for order", order.id);
      return false;
    }

    console.log(`Generating Shiprocket invoice for order #${order.id}...`);

    if (!order.shiprocket_order_id) {
      logInvoiceDiagnostic(
        "stage failed: validating invoice prerequisites; status=unavailable; message=Shiprocket order ID is missing",
      );
      console.warn(
        `Shiprocket order ID missing for order #${order.id}. Invoice email skipped.`,
      );
      return false;
    }

    stage = "generating Shiprocket invoice";
    const invoiceResponse = await generateShiprocketInvoice(
      order.shiprocket_order_id,
    );

    stage = "validating invoice URL";
    const invoiceUrl =
      invoiceResponse?.invoice_url ||
      invoiceResponse?.invoiceUrl ||
      invoiceResponse?.url ||
      invoiceResponse?.data?.invoice_url ||
      invoiceResponse?.data?.invoiceUrl ||
      invoiceResponse?.data?.url;

    if (!invoiceUrl) {
      logInvoiceDiagnostic(
        `stage failed: ${stage}; status=unavailable; message=Shiprocket invoice URL is missing`,
      );
      console.error("Shiprocket invoice URL missing.");

      return false;
    }

    logInvoiceDiagnostic("invoice URL obtained");
    console.log(`Downloading Shiprocket invoice for order #${order.id}...`);

    stage = "downloading Shiprocket invoice";
    const pdfBuffer = await downloadShiprocketInvoice(invoiceUrl);
    logInvoiceDiagnostic("invoice download completed");

    stage = "validating downloaded PDF";
    const isBuffer = Buffer.isBuffer(pdfBuffer);
    const hasContent = isBuffer && pdfBuffer.length > 0;
    const hasPdfHeader =
      hasContent && pdfBuffer.subarray(0, 5).toString("ascii") === "%PDF-";
    logInvoiceDiagnostic(
      `PDF validation: buffer=${isBuffer}; nonempty=${hasContent}; PDF header=${hasPdfHeader}; content type validated by Shiprocket downloader`,
    );

    stage = "preparing invoice email";
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

    stage = "preparing attachment";
    const attachment = {
      filename: `Invoice_Bhatkar_${order.id}.pdf`,
      content: pdfBuffer,
    };
    logInvoiceDiagnostic(
      `attachment prepared: buffer=${Buffer.isBuffer(attachment.content)}; bytes=${Buffer.isBuffer(attachment.content) ? attachment.content.length : 0}`,
    );

    console.log("Sending invoice email via Resend...");
    stage = "calling Resend API";
    logInvoiceDiagnostic("calling Resend API");
    const result = await resend.emails.send({
      from: fromEmail,
      to: to,
      subject: subject,
      html: htmlContent,
      attachments: [attachment],
    });

    if (result?.error) {
      logInvoiceDiagnostic(
        `Resend API returned an error: stage=${stage}; status=${getSafeStatusCode(
          result.error,
        )}; message=${sanitizeDiagnosticMessage(result.error)}`,
      );

      console.error("Invoice email delivery failed.");
      return false;
    }

    logInvoiceDiagnostic("API call completed");
    return true;
  } catch (error) {
    logInvoiceDiagnostic(
      `stage failed: ${stage}; status=${getSafeStatusCode(error)}; message=${sanitizeDiagnosticMessage(error)}`,
    );
    console.error("Invoice email delivery failed.");
    return false;
  }
};

/**
 * Sends OTP verification email via Resend email service
 */
export const sendOTPEmail = async (email, otp) => {
  const apiKey = process.env.RESEND_API_KEY;
  const resend = getResendClient();
  const fromEmail = process.env.EMAIL_FROM || "noreply@bhatkarco.com";

  if (!apiKey || !resend) {
    if (
      process.env.NODE_ENV === "development" &&
      process.env.OTP_DEV_FALLBACK === "true" &&
      otp === "000000"
    ) {
      console.warn("OTP development fallback is active.");
      return true;
    }

    throw new Error("OTP email delivery is unavailable.");
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

    await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: subject,
      html: htmlContent,
    });

    return true;
  } catch {
    console.error("OTP email delivery failed.");
    throw new Error("OTP email delivery failed.");
  }
};
