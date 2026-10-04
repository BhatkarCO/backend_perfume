import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { Resend } from 'resend';

dotenv.config();

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

let transporter = null;

const isEmailConfigured = 
  process.env.EMAIL_HOST && 
  process.env.EMAIL_USER && 
  process.env.EMAIL_PASS;

if (isEmailConfigured) {
  try {
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || '5856'),
      secure: process.env.EMAIL_PORT === '465',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
    console.log('Nodemailer SMTP client initialized.');
  } catch {
    console.error('Error creating email transporter.');
  }
} else {
  console.log('SMTP credentials not configured. Email simulation is enabled.');
}

/**
 * Sends an email notification (falls back to console logging)
 * @param {string} to - Recipient email
 * @param {string} subject - Subject line
 * @param {string} text - Plain text message
 * @param {string} html - HTML formatted message
 * @returns {Promise<boolean>}
 */
export const sendEmail = async ({ to, subject, text, html }) => {
  const from = process.env.EMAIL_FROM || 'noreply@bhatkar-perfumes.com';
  
  if (isEmailConfigured && transporter) {
    try {
      await transporter.sendMail({
        from,
        to,
        subject,
        text,
        html,
      });
      return true;
    } catch {
      console.error('Nodemailer email delivery failed.');
      // fallback to console log
    }
  }
  

  // Developer console fallback
  console.log('\n==================================================');
  console.log(`[EMAIL SEND SIMULATION]`);
  console.log('Email delivery unavailable.');
  console.log('Email content omitted.');
  console.log('==================================================\n');
  return true;
};

export const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Sends a contact form submission email via Resend
 * @param {Object} user - User/Contact information
 * @param {string} user.name - Name of sender
 * @param {string} user.email - Email of sender
 * @param {string} user.message - Message content
 * @returns {Promise<boolean>}
 */
export const sendContactEmail = async (user) => {
  if (!resend) {
    console.warn("RESEND_API_KEY not configured. Skipping contact form email.");
    
    // Developer console fallback
    console.log('\n==================================================');
    console.log(`[RESEND SIMULATION]`);
    console.log(`From: Website Contact <support@bhatkarco.com>`);
    console.log(`To: support@bhatkarco.com`);
    console.log('Contact form message received; content omitted.');
    console.log('==================================================\n');
    return true;
  }

  try {
    const name = escapeHtml(user.name);
    const email = escapeHtml(user.email);
    const subject = escapeHtml(user.subject || "");
    const message = escapeHtml(user.message).replace(/\r?\n/g, "<br>");

    await resend.emails.send({
      from: "Website Contact <support@bhatkarco.com>",
      to: "support@bhatkarco.com",
      replyTo: user.email,
      subject: "Contact form submission",
      html: `
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <p><strong>Message:</strong></p>
        <p>${message}</p>
      `,
    });
    return true;
  } catch {
    console.error("Resend contact email delivery failed.");
    return false;
  }
};