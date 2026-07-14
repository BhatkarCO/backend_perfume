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
  } catch (err) {
    console.error('Error creating email transporter:', err);
  }
} else {
  console.log('SMTP credentials not configured. Emails will be logged to the server console.');
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
    } catch (err) {
      console.error('Nodemailer failed to send email:', err);
      // fallback to console log
    }
  }
  

  // Developer console fallback
  console.log('\n==================================================');
  console.log(`[EMAIL SEND SIMULATION]`);
  console.log(`From: ${from}`);
  console.log(`To: ${to}`);
  console.log(`Subject: ${subject}`);
  console.log(`Text Message: ${text}`);
  console.log('==================================================\n');
  return true;
};

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
    console.log(`Reply-To: ${user.email}`);
    console.log(`Subject: Contact Form: ${user.name}`);
    console.log(`Message: ${user.message}`);
    console.log('==================================================\n');
    return true;
  }

  try {
    await resend.emails.send({
      from: "Website Contact <support@bhatkarco.com>",
      to: "support@bhatkarco.com",
      replyTo: user.email,
      subject: `Contact Form: ${user.name}`,
      html: `
        <p><strong>Name:</strong> ${user.name}</p>
        <p><strong>Email:</strong> ${user.email}</p>
        <p><strong>Message:</strong></p>
        <p>${user.message}</p>
      `,
    });
    return true;
  } catch (error) {
    console.error("Resend contact email delivery failed:", error);
    return false;
  }
};

