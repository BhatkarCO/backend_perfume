import NewsletterSubscriber from "../models/NewsletterSubscriber.js";
import ContactMessage from "../models/ContactMessage.js";
import { sendEmail, sendContactEmail } from "../utils/email.js";


/**
 * Subscribe to newsletter
 */
export const subscribeNewsletter = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email address is required." });
  }

  try {
    // Upsert to ignore conflicts (equivalent to ON CONFLICT DO NOTHING)
    await NewsletterSubscriber.updateOne(
      { email: email.toLowerCase() },
      { $setOnInsert: { email: email.toLowerCase() } },
      { upsert: true }
    );

    // Send confirmation email
    await sendEmail({
      to: email,
      subject: "Subscribed to Bhatkar Perfumes Newsletter",
      text: "Thank you for subscribing to the Bhatkar Perfumes newsletter! We will keep you updated on new collections and exclusive discounts.",
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #FAF9F6; color: #1F1F1F; padding: 30px; border-radius: 4px; border: 1px solid #E4E4E0;">
          <h2 style="color: #B89765; text-align: center; font-family: 'Playfair Display', Georgia, serif;">BHATKAR PERFUMES</h2>
          <p>Thank you for subscribing to the Bhatkar Perfumes newsletter! You are now part of our inner circle.</p>
          <p>Expect updates on brand releases, exclusive perfume drops, and member-only coupon discounts.</p>
        </div>
      `,
    });

    res.status(200).json({ message: "Subscribed to newsletter successfully!" });
  } catch (error) {
    console.error("Newsletter subscribe error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * Submit Contact Message
 */
export const submitContactForm = async (req, res) => {
  const { name, email, subject, message } = req.body;

  if (!name || !email || !message) {
    return res
      .status(400)
      .json({ message: "Name, email, and message are required." });
  }

  try {
    const contactMessage = new ContactMessage({
      name,
      email: email.toLowerCase(),
      subject: subject || null,
      message,
    });
    await contactMessage.save();

    // Send alert email to admin via Resend
    await sendContactEmail({ name, email, message });


    res
      .status(201)
      .json({
        message: "Message sent successfully! We will get back to you shortly.",
      });
  } catch (error) {
    console.error("Contact form submission error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};
