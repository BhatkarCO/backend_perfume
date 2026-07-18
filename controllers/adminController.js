import Product from "../models/Product.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import bcrypt from "bcryptjs";
import InventoryLog from "../models/InventoryLog.js";
import { uploadAsset } from "../config/cloudinary.js";
import { sendEmail } from "../utils/email.js";
import { sendOTPEmail } from "../utils/resendEmail.js";

// --- PRODUCT MANAGEMENT ---

/**
 * Add a new product (Admin only)
 */
export const addProduct = async (req, res) => {
  const {
    name,
    description,
    short_description,
    price,
    sale_price,
    stock_quantity,
    category_id,
    gender,
    is_featured,
    is_best_selling,
    is_new_arrival,
    fragrance_notes, // JSON string
  } = req.body;

  if (!name || !description || !price || !gender) {
    return res
      .status(400)
      .json({ message: "Name, description, price, and gender are required." });
  }

  if (sale_price && parseFloat(sale_price) > parseFloat(price)) {
    return res.status(400).json({
      message: "Sale price cannot be higher than the standard price (MRP).",
    });
  }

  try {
    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") +
      "-" +
      Date.now();

    let parsedNotes = null;
    if (fragrance_notes) {
      parsedNotes =
        typeof fragrance_notes === "string"
          ? JSON.parse(fragrance_notes)
          : fragrance_notes;
    }

    const dbGender = gender
      ? gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase()
      : null;

    // Handle uploaded images if any
    const images = [];
    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const uploadedUrl = await uploadAsset(
          file.buffer,
          file.originalname,
          file.mimetype,
        );
        images.push({
          image_url: uploadedUrl,
          is_primary: i === 0,
        });
      }
    }

    const newProduct = new Product({
      name,
      slug,
      description,
      short_description: short_description || null,
      price: parseFloat(price),
      sale_price: sale_price ? parseFloat(sale_price) : null,
      stock_quantity: parseInt(stock_quantity || "0"),
      category_id: category_id || null,
      gender: dbGender,
      is_featured: is_featured === "true" || is_featured === true,
      is_best_selling: is_best_selling === "true" || is_best_selling === true,
      is_new_arrival: is_new_arrival === "true" || is_new_arrival === true,
      fragrance_notes: parsedNotes,
      images,
    });

    await newProduct.save();

    // Log inventory log
    const log = new InventoryLog({
      product_id: newProduct.id,
      change_amount: newProduct.stock_quantity,
      reason: "Admin creation initial stock",
    });
    await log.save();

    res
      .status(201)
      .json({ message: "Product added successfully.", product: newProduct });
  } catch (error) {
    console.error("Add product error:", error);
    res.status(500).json({ message: "Error adding product." });
  }
};

/**
 * Edit an existing product (Admin only)
 */
export const editProduct = async (req, res) => {
  const { id } = req.params;
  const {
    name,
    description,
    short_description,
    price,
    sale_price,
    stock_quantity,
    category_id,
    gender,
    is_featured,
    is_best_selling,
    is_new_arrival,
    fragrance_notes,
  } = req.body;

  try {
    // Check if exists
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }

    const finalPrice = price ? parseFloat(price) : product.price;
    const finalSalePrice =
      sale_price !== undefined
        ? sale_price
          ? parseFloat(sale_price)
          : null
        : product.sale_price;

    if (finalSalePrice && finalSalePrice > finalPrice) {
      return res.status(400).json({
        message: "Sale price cannot be higher than the standard price (MRP).",
      });
    }

    const previousStock = product.stock_quantity;
    const slug = name
      ? name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "") +
        "-" +
        Date.now()
      : undefined;

    let parsedNotes = undefined;
    if (fragrance_notes) {
      parsedNotes =
        typeof fragrance_notes === "string"
          ? JSON.parse(fragrance_notes)
          : fragrance_notes;
    }

    // Update fields
    if (name) {
      product.name = name;
      product.slug = slug;
    }
    if (description) product.description = description;
    if (short_description !== undefined)
      product.short_description = short_description;
    if (price) product.price = parseFloat(price);
    if (sale_price !== undefined)
      product.sale_price = sale_price ? parseFloat(sale_price) : null;
    if (stock_quantity !== undefined)
      product.stock_quantity = parseInt(stock_quantity);
    if (category_id !== undefined) product.category_id = category_id || null;
    if (gender)
      product.gender =
        gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase();

    if (is_featured !== undefined) {
      product.is_featured = is_featured === "true" || is_featured === true;
    }
    if (is_best_selling !== undefined) {
      product.is_best_selling =
        is_best_selling === "true" || is_best_selling === true;
    }
    if (is_new_arrival !== undefined) {
      product.is_new_arrival =
        is_new_arrival === "true" || is_new_arrival === true;
    }
    if (parsedNotes !== undefined) {
      product.fragrance_notes = parsedNotes;
    }

    // Log stock change if stock_quantity was updated
    if (
      stock_quantity !== undefined &&
      parseInt(stock_quantity) !== previousStock
    ) {
      const difference = parseInt(stock_quantity) - previousStock;
      const log = new InventoryLog({
        product_id: id,
        change_amount: difference,
        reason: "Admin stock adjustment manual update",
      });
      await log.save();
    }

    // Process new images if uploaded
    if (req.files && req.files.length > 0) {
      const hasPrimary = product.images.some((img) => img.is_primary);
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const uploadedUrl = await uploadAsset(
          file.buffer,
          file.originalname,
          file.mimetype,
        );

        const setPrimary = !hasPrimary && i === 0;
        product.images.push({
          image_url: uploadedUrl,
          is_primary: setPrimary,
        });
      }
    }

    await product.save();
    res.status(200).json({ message: "Product updated successfully.", product });
  } catch (error) {
    console.error("Edit product error:", error);
    res.status(500).json({ message: "Error updating product." });
  }
};

/**
 * Delete product (Admin only)
 */
export const deleteProduct = async (req, res) => {
  const { id } = req.params;

  try {
    const deletedProduct = await Product.findByIdAndDelete(id);
    if (!deletedProduct) {
      return res.status(404).json({ message: "Product not found." });
    }

    res.status(200).json({
      message: `Product '${deletedProduct.name}' deleted successfully.`,
    });
  } catch (error) {
    console.error("Delete product error:", error);
    res.status(500).json({ message: "Error deleting product." });
  }
};

// --- ORDER MANAGEMENT ---

/**
 * View all orders (Admin only)
 */
export const getAdminOrders = async (req, res) => {
  try {
    const orders = await Order.find()
      .populate("user_id")
      .sort({ created_at: -1 })
      .lean();

    const formattedOrders = orders.map((o) => ({
      ...o,
      id: o._id.toString(),
      customer_name: o.user_id?.name || "Unknown",
      customer_email: o.user_id?.email || "Unknown",
    }));

    res.status(200).json(formattedOrders);
  } catch (error) {
    console.error("Admin get orders error:", error);
    res.status(500).json({ message: "Error retrieving orders." });
  }
};

/**
 * Update order status (Admin only)
 */
export const updateOrderStatus = async (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;

  const validStatuses = [
    "Pending",
    "Confirmed",
    "Processing",
    "Shipped",
    "Delivered",
    "Cancelled",
  ];

  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ message: "Invalid status value." });
  }

  try {
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    order.status = status;
    order.updated_at = new Date();
    await order.save();

    // Get customer details
    const customer = await User.findById(order.user_id);
    if (customer) {
      // Send email alert on status change
      await sendEmail({
        to: customer.email,
        subject: `Order #${orderId} Status Updated: ${status}`,
        text: `Hello ${customer.name}, your order #${orderId} status has been updated to: ${status}. Thank you for shopping with Bhatkar Perfumes!`,
        html: `
          <div style="font-family: Arial, sans-serif; background-color: #FAF9F6; color: #1F1F1F; padding: 30px; border-radius: 4px; border: 1px solid #E4E4E0;">
            <h2 style="color: #B89765; font-family: 'Playfair Display', Georgia, serif;">Order Status Update</h2>
            <p>Hello ${customer.name},</p>
            <p>Your order <strong>#${orderId}</strong> has been updated to: <span style="color: #B89765; font-weight: bold;">${status}</span></p>
            <p>Thank you for shopping with Bhatkar Perfumes!</p>
          </div>
        `,
      });
    }

    res
      .status(200)
      .json({ message: "Order status updated successfully.", order });
  } catch (error) {
    console.error("Update order status error:", error);
    res.status(500).json({ message: "Error updating order status." });
  }
};

// --- CUSTOMER MANAGEMENT ---

/**
 * Get all users (Admin only)
 */
export const getAdminUsers = async (req, res) => {
  try {
    const users = await User.find()
      .select("email role name phone is_verified created_at")
      .sort({ created_at: -1 })
      .lean();

    const formattedUsers = users.map((u) => ({
      ...u,
      id: u._id.toString(),
    }));

    res.status(200).json(formattedUsers);
  } catch (error) {
    console.error("Admin get users error:", error);
    res.status(500).json({ message: "Error retrieving users." });
  }
};

/**
 * Block / Unblock User (Admin only)
 * Sets role to 'blocked' or reverts to 'user'
 */
export const toggleBlockUser = async (req, res) => {
  const { userId } = req.params;
  const { block } = req.body; // boolean

  try {
    const role = block ? "blocked" : "user";
    const user = await User.findByIdAndUpdate(
      userId,
      { role },
      { new: true },
    ).select("id email role name");

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    res.status(200).json({
      message: block
        ? "User blocked successfully."
        : "User unblocked successfully.",
      user,
    });
  } catch (error) {
    console.error("Block user error:", error);
    res.status(500).json({ message: "Error editing user privileges." });
  }
};

// --- ANALYTICS & REPORTS ---

/**
 * Get Admin dashboard reports (Admin only)
 */
export const getAdminReports = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let dateFilter = {};
    if (startDate || endDate) {
      dateFilter.created_at = {};
      if (startDate) {
        dateFilter.created_at.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.created_at.$lte = end;
      }
    }

    const allTimeCondition = { status: { $nin: ["Pending", "Cancelled"] } };
    const matchCondition = { status: { $nin: ["Pending", "Cancelled"] } };
    if (dateFilter.created_at) {
      matchCondition.created_at = dateFilter.created_at;
    }

    // 1. Sales & Revenue Analytics (excluding Pending/Cancelled orders)
    const salesStats = await Order.aggregate([
      { $match: allTimeCondition },
      {
        $group: {
          _id: null,
          total_orders: { $sum: 1 },
          total_revenue: { $sum: "$total_amount" },
          avg_order_value: { $avg: "$total_amount" },
        },
      },
    ]);

    const summary = salesStats[0]
      ? {
          total_orders: salesStats[0].total_orders.toString(),
          total_revenue: salesStats[0].total_revenue.toFixed(2),
          avg_order_value: salesStats[0].avg_order_value.toFixed(2),
        }
      : {
          total_orders: "0",
          total_revenue: "0.00",
          avg_order_value: "0.00",
        };

    // 2. Inventory Alert (Products below threshold of 10 items)
    const lowStockRaw = await Product.find({ stock_quantity: { $lt: 10 } })
      .select("name slug stock_quantity price")
      .sort({ stock_quantity: 1 })
      .lean();

    const lowStock = lowStockRaw.map((p) => ({
      ...p,
      id: p._id.toString(),
    }));

    // 3. Top-selling Perfumes
    const topProducts = await Order.aggregate([
      { $match: matchCondition },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.product_id",
          total_sold: { $sum: "$items.quantity" },
        },
      },
      { $sort: { total_sold: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },
      {
        $project: {
          id: "$_id",
          name: "$product.name",
          slug: "$product.slug",
          price: "$product.price",
          rating: "$product.rating",
          total_sold: 1,
          _id: 0,
        },
      },
    ]);

    // 4. Sales over time (Daily sales for range or default last 7 days)
    const dailyMatch = { status: { $nin: ["Pending", "Cancelled"] } };
    if (dateFilter.created_at) {
      dailyMatch.created_at = dateFilter.created_at;
    } else {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      dailyMatch.created_at = { $gte: sevenDaysAgo };
    }

    const dailySales = await Order.aggregate([
      { $match: dailyMatch },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
          orders_count: { $sum: 1 },
          revenue: { $sum: "$total_amount" },
        },
      },
      {
        $project: {
          date: "$_id",
          orders_count: 1,
          revenue: 1,
          _id: 0,
        },
      },
      { $sort: { date: 1 } },
    ]);

    // 5. Date-wise collection
    const dateWise = await Order.aggregate([
      { $match: matchCondition },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
          revenue: { $sum: "$total_amount" },
          orders_count: { $sum: 1 },
        },
      },
      {
        $project: {
          date: "$_id",
          revenue: 1,
          orders_count: 1,
          _id: 0,
        },
      },
      { $sort: { date: -1 } },
    ]);

    // 6. Day-wise collection (Day of the week)
    const dayWise = await Order.aggregate([
      { $match: matchCondition },
      {
        $group: {
          _id: { $dayOfWeek: "$created_at" },
          revenue: { $sum: "$total_amount" },
          orders_count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const dayWiseFormatted = dayWise.map((d) => ({
      day: dayNames[d._id - 1] || `Unknown (${d._id})`,
      revenue: d.revenue.toFixed(2),
      orders_count: d.orders_count,
    }));

    // 7. Week-wise collection
    const weekWise = await Order.aggregate([
      { $match: matchCondition },
      {
        $group: {
          _id: { $dateToString: { format: "%G-W%V", date: "$created_at" } },
          revenue: { $sum: "$total_amount" },
          orders_count: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
    ]);
    const weekWiseFormatted = weekWise.map((w) => {
      const parts = w._id.split("-W");
      return {
        week: parts[1] ? `Week ${parts[1]}, ${parts[0]}` : w._id,
        revenue: w.revenue.toFixed(2),
        orders_count: w.orders_count,
      };
    });

    // 8. Month-wise collection
    const monthWise = await Order.aggregate([
      { $match: matchCondition },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$created_at" } },
          revenue: { $sum: "$total_amount" },
          orders_count: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
    ]);
    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const monthWiseFormatted = monthWise.map((m) => {
      const [year, monthStr] = m._id.split("-");
      const monthIndex = parseInt(monthStr, 10) - 1;
      return {
        month:
          monthIndex >= 0 && monthIndex < 12
            ? `${monthNames[monthIndex]} ${year}`
            : m._id,
        revenue: m.revenue.toFixed(2),
        orders_count: m.orders_count,
      };
    });

    res.status(200).json({
      summary,
      lowStock,
      topProducts,
      dailySales,
      dateWise,
      dayWise: dayWiseFormatted,
      weekWise: weekWiseFormatted,
      monthWise: monthWiseFormatted,
    });
  } catch (error) {
    console.error("Fetch admin reports error:", error);
    res.status(500).json({ message: "Error compiling analytics reports." });
  }
};

export const forgotAdminPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const admin = await User.findOne({
      email: email.toLowerCase(),
      role: "admin",
    });

    if (!admin) {
      return res.status(404).json({
        message: "Admin account not found.",
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    admin.otp_code = otp;
    admin.otp_expires_at = new Date(Date.now() + 10 * 60 * 1000);

    await admin.save();

    await sendOTPEmail(admin.email, otp);

    res.json({
      message: "If an admin account exists for this email, an OTP has been sent.",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Server Error",
    });
  }
};

export const resetAdminPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    const admin = await User.findOne({
      email: email.toLowerCase(),
      role: "admin",
    });

    if (!admin) {
      return res.status(404).json({
        message: "Admin not found.",
      });
    }

    if (
      admin.otp_code !== otp ||
      !admin.otp_expires_at ||
      admin.otp_expires_at < new Date()
    ) {
      return res.status(400).json({
        message: "Invalid or expired OTP.",
      });
    }

    admin.password_hash = await bcrypt.hash(newPassword, 10);

    admin.otp_code = undefined;
    admin.otp_expires_at = undefined;

    await admin.save();

    res.json({
      message: "Password reset successfully.",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Server Error",
    });
  }
};