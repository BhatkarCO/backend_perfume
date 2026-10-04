import mongoose from "mongoose";
import Review from "../models/Review.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import Coupon from "../models/Coupon.js";
import bcrypt from "bcryptjs";
import OTP from "../models/OTP.js";
import { generateOTP } from "../utils/otp.js";
import InventoryLog from "../models/InventoryLog.js";
import { uploadAsset } from "../config/cloudinary.js";
import { sendEmail } from "../utils/email.js";
import { sendOTPEmail } from "../utils/resendEmail.js";

import { isSafeProductImage } from "../middleware/upload.js";

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
  const initialStock =
    stock_quantity === undefined || stock_quantity === ""
      ? 0
      : Number(stock_quantity);

  if (!name || !description || !price || !gender) {
    return res
      .status(400)
      .json({ message: "Name, description, price, and gender are required." });
  }

  if (!Number.isInteger(initialStock) || initialStock < 0) {
    return res.status(400).json({
      message: "Stock quantity must be a non-negative integer.",
    });
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

        if (!(await isSafeProductImage(file.buffer))) {
          return res.status(400).json({
            message: "Invalid image content.",
          });
        }

        const uploadedImage = await uploadAsset(
          file.buffer,
          file.originalname,
          file.mimetype,
        );

        product.images.push({
          image_url: uploadedImage.image_url,
          public_id: uploadedImage.public_id,
          is_primary: setPrimary,
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
      stock_quantity: initialStock,
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
    deletedImages,
  } = req.body;

  try {
    // Check if exists
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }

    const requestedStock =
      stock_quantity === undefined ? undefined : Number(stock_quantity);
    if (
      requestedStock !== undefined &&
      (!Number.isInteger(requestedStock) || requestedStock < 0)
    ) {
      return res.status(400).json({
        message: "Stock quantity must be a non-negative integer.",
      });
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
    if (requestedStock !== undefined) product.stock_quantity = requestedStock;
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
    if (stock_quantity !== undefined && requestedStock !== previousStock) {
      const difference = requestedStock - previousStock;
      const log = new InventoryLog({
        product_id: id,
        change_amount: difference,
        reason: "Admin stock adjustment manual update",
      });
      await log.save();
    }

    // Remove deleted images
    if (deletedImages) {
      const deleted =
        typeof deletedImages === "string"
          ? JSON.parse(deletedImages)
          : deletedImages;

      product.images = product.images.filter(
        (img) => !deleted.includes(img.image_url),
      );
    }

    // Process new images if uploaded
    if (req.files && req.files.length > 0) {
      const hasPrimary = product.images.some((img) => img.is_primary);
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];

        if (!(await isSafeProductImage(file.buffer))) {
          return res.status(400).json({
            message: "Invalid image content.",
          });
        }

        const uploadedImage = await uploadAsset(
          file.buffer,
          file.originalname,
          file.mimetype,
        );

        product.images.push({
          image_url: uploadedImage.image_url,
          public_id: uploadedImage.public_id,
          is_primary: product.images.length === 0,
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
    const session = await mongoose.startSession();
    let deletedProduct = null;
    let hasReservation = false;
    try {
      await session.withTransaction(async () => {
        hasReservation = Boolean(
          await Order.findOne({
            items: { $elemMatch: { product_id: id } },
            inventory_status: "Reserved",
          })
            .select("_id")
            .session(session),
        );

        if (hasReservation) {
          return;
        }

        const product = await Product.findById(id).session(session);
        if (product) {
          await product.deleteOne({ session });
          deletedProduct = product;
        }
      });
    } finally {
      await session.endSession();
    }

    if (hasReservation) {
      return res.status(409).json({
        message: "Product has orders with reserved inventory.",
      });
    }

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

export const getProductReviewsAdmin = async (req, res) => {
  try {
    const { productId } = req.params;

    const reviews = await Review.find({
      product_id: productId,
    })
      .populate("user_id", "name email")
      .sort({ created_at: -1 })
      .lean();

    res.status(200).json(reviews);
  } catch (error) {
    console.error("Get reviews error:", error);
    res.status(500).json({
      message: "Failed to fetch reviews.",
    });
  }
};

export const deleteReview = async (req, res) => {
  try {
    console.log("==== DELETE REVIEW START ====");

    const { reviewId } = req.params;

    const review = await Review.findById(reviewId);

    if (!review) {
      return res.status(404).json({
        message: "Review not found.",
      });
    }

    await Review.findByIdAndDelete(reviewId);

    const avg = await Review.aggregate([
      {
        $match: {
          product_id: review.product_id,
        },
      },
      {
        $group: {
          _id: null,
          avgRating: {
            $avg: "$rating",
          },
        },
      },
    ]);

    await Product.findByIdAndUpdate(review.product_id, {
      rating: avg.length ? Number(avg[0].avgRating.toFixed(2)) : 0,
    });

    return res.status(200).json({
      message: "Review deleted successfully.",
    });
  } catch (err) {
    console.error("DELETE REVIEW ERROR:", err);

    return res.status(500).json({
      message: err.message,
    });
  }
};

// --- ORDER MANAGEMENT ---

/**
 * View all confirmed orders (Admin only)
 *
 * COD orders are valid immediately.
 * Razorpay orders are valid only after payment is confirmed.
 */
export const getAdminOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      $or: [
        // COD orders are legitimate orders immediately
        { payment_method: "COD" },

        // Razorpay orders only become orders after successful payment
        {
          payment_method: "RAZORPAY",
          payment_status: "Paid",
        },
      ],
    })
      .populate("user_id", "name email")
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
    res.status(500).json({
      message: "Error retrieving orders.",
    });
  }
};

/**
 * Get single order details (Admin only)
 */
export const getAdminOrderById = async (req, res) => {
  const { orderId } = req.params;

  try {
    const order = await Order.findById(orderId)
      .populate("user_id", "name email phone")
      .populate("shipping_address_id")
      .populate("items.product_id");

    if (!order) {
      return res.status(404).json({
        message: "Order not found.",
      });
    }

    const orderObj = order.toObject();

    // Customer details
    orderObj.customer_name = order.user_id?.name || "Unknown";
    orderObj.customer_email = order.user_id?.email || "Unknown";
    orderObj.customer_phone = order.user_id?.phone || "";

    // Shipping address
    orderObj.address_line1 = order.shipping_address_id?.address_line1 || "";
    orderObj.address_line2 = order.shipping_address_id?.address_line2 || "";
    orderObj.city = order.shipping_address_id?.city || "";
    orderObj.state = order.shipping_address_id?.state || "";
    orderObj.postal_code = order.shipping_address_id?.postal_code || "";
    orderObj.shipping_phone = order.shipping_address_id?.phone || "";
    orderObj.country = order.shipping_address_id?.country || "India";

    // Order items
    orderObj.items = order.items.map((item) => {
      const product = item.product_id;

      const primaryImage =
        product?.images?.find((img) => img.is_primary)?.image_url ||
        product?.images?.[0]?.image_url ||
        null;

      return {
        product_id: product?._id,
        name: product?.name || "Product",
        slug: product?.slug,
        quantity: item.quantity,
        price_at_purchase: item.price_at_purchase,
        primary_image: primaryImage,
      };
    });

    orderObj.id = order._id.toString();

    res.status(200).json(orderObj);
  } catch (error) {
    console.error("Admin get order details error:", error);

    res.status(500).json({
      message: "Error retrieving order details.",
    });
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
    let order;
    if (status === "Cancelled") {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const existingOrder = await Order.findById(orderId).session(session);
          if (
            !existingOrder ||
            existingOrder.payment_status === "Paid" ||
            existingOrder.status === "Cancelled"
          ) {
            order = existingOrder;
            return;
          }

          order = await Order.findOneAndUpdate(
            {
              _id: orderId,
              status: { $ne: "Cancelled" },
              payment_status: { $ne: "Paid" },
            },
            {
              $set: {
                status,
                updated_at: new Date(),
              },
            },
            { returnDocument: "after", session },
          );

          if (
            !order ||
            existingOrder.payment_method !== "COD" ||
            existingOrder.inventory_status !== "Reserved"
          ) {
            return;
          }

          const quantitiesByProduct = new Map();
          for (const item of existingOrder.items) {
            const productId = item.product_id.toString();
            quantitiesByProduct.set(
              productId,
              (quantitiesByProduct.get(productId) || 0) + Number(item.quantity),
            );
          }

          for (const [productId, quantity] of quantitiesByProduct) {
            const stockUpdate = await Product.updateOne(
              { _id: productId },
              { $inc: { stock_quantity: quantity } },
              { session },
            );

            if (stockUpdate.matchedCount !== 1) {
              throw new Error("Unable to release reserved inventory.");
            }

            await InventoryLog.create(
              [
                {
                  product_id: productId,
                  change_amount: quantity,
                  reason: `Reservation released - Order #${orderId}`,
                },
              ],
              { session },
            );
          }

          order.inventory_status = "Released";
          await order.save({ session });
        });
      } finally {
        await session.endSession();
      }
    } else {
      order = await Order.findOneAndUpdate(
        {
          _id: orderId,
          inventory_status: { $ne: "Released" },
          status: { $ne: "Cancelled" },
        },
        {
          $set: {
            status,
            updated_at: new Date(),
          },
        },
        { returnDocument: "after" },
      );

      if (!order) {
        const existingOrder = await Order.findById(orderId).select(
          "inventory_status status",
        );

        if (!existingOrder) {
          return res.status(404).json({ message: "Order not found." });
        }

        if (existingOrder.inventory_status === "Released") {
          return res.status(409).json({
            message:
              "This order has already released its inventory and cannot be reopened.",
          });
        }

        if (existingOrder.status === "Cancelled") {
          return res.status(409).json({
            message:
              "This order has already been cancelled and cannot be reopened.",
          });
        }

        return res.status(409).json({
          message: "Order status changed before the update could be applied.",
        });
      }
    }

    if (status === "Cancelled" && order?.payment_status === "Paid") {
      return res.status(409).json({
        message: "A paid order cannot be cancelled.",
      });
    }

    if (!order) {
      const existingOrder =
        await Order.findById(orderId).select("payment_status");
      if (existingOrder?.payment_status === "Paid") {
        return res.status(409).json({
          message: "A paid order cannot be cancelled.",
        });
      }
      return res.status(404).json({ message: "Order not found." });
    }

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
 */
export const toggleBlockUser = async (req, res) => {
  const { userId } = req.params;
  const { block } = req.body;

  try {
    // Prevent admin from blocking themselves
    if (req.user.id === userId) {
      return res.status(400).json({
        message: "You cannot block your own account.",
      });
    }

    const targetUser = await User.findById(userId);

    if (!targetUser) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    // Prevent blocking any admin account
    if (targetUser.role === "admin") {
      return res.status(400).json({
        message: "Admin accounts cannot be blocked.",
      });
    }

    targetUser.role = block ? "blocked" : "user";

    await targetUser.save();

    return res.status(200).json({
      message: block
        ? "User blocked successfully."
        : "User unblocked successfully.",
      user: {
        id: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        role: targetUser.role,
      },
    });
  } catch (error) {
    console.error("Block user error:", error);
    return res.status(500).json({
      message: "Error editing user privileges.",
    });
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
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const genericResponse = {
      message:
        "If an admin account exists for this email, an OTP has been sent.",
    };

    if (!email) {
      return res.status(200).json(genericResponse);
    }

    const admin = await User.findOne({
      email,
      role: "admin",
    });

    if (!admin) {
      return res.status(200).json(genericResponse);
    }

    const existingOTP = await OTP.findOne({
      email,
      purpose: "admin-forgot-password",
    });

    if (existingOTP) {
      const elapsed = Date.now() - new Date(existingOTP.lastSentAt).getTime();

      if (elapsed < 60000) {
        return res.status(200).json(genericResponse);
      }
    }

    const otp = generateOTP();
    const hashedOTP = await bcrypt.hash(otp, 10);

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    if (existingOTP) {
      existingOTP.otp = hashedOTP;
      existingOTP.expiresAt = expiresAt;
      existingOTP.attempts = 0;
      existingOTP.lastSentAt = new Date();
      existingOTP.verified = false;

      await existingOTP.save();
    } else {
      await OTP.create({
        email,
        otp: hashedOTP,
        purpose: "admin-forgot-password",
        expiresAt,
        lastSentAt: new Date(),
      });
    }

    await sendOTPEmail(email, otp);

    return res.status(200).json(genericResponse);
  } catch (error) {
    console.error("Admin forgot password error:", error);

    return res.status(500).json({
      message: "Unable to process password reset request.",
    });
  }
};

export const resetAdminPassword = async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const otp = String(req.body.otp || "").trim();
    const newPassword = req.body.newPassword;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        message: "Email, OTP, and new password are required.",
      });
    }

    const now = new Date();
    const otpRecord = await OTP.findOneAndUpdate(
      {
        email,
        purpose: "admin-forgot-password",
        expiresAt: { $gt: now },
        attempts: { $lt: 5 },
      },
      { $inc: { attempts: 1 } },
      { returnDocument: "after" },
    );

    if (!otpRecord) {
      return res.status(400).json({
        message: "Invalid or expired OTP.",
      });
    }

    const attemptWindowMs = 15 * 60 * 1000;
    const attemptWindowStart = new Date(now.getTime() - attemptWindowMs);
    const attemptState = await User.findOneAndUpdate(
      {
        email,
        role: "admin",
        $or: [
          { admin_reset_attempts: { $lt: 5 } },
          { admin_reset_attempts_reset_at: { $lte: attemptWindowStart } },
          { admin_reset_attempts_reset_at: { $exists: false } },
        ],
      },
      [
        {
          $set: {
            admin_reset_attempts: {
              $cond: [
                {
                  $lte: [
                    {
                      $ifNull: ["$admin_reset_attempts_reset_at", new Date(0)],
                    },
                    attemptWindowStart,
                  ],
                },
                1,
                { $add: [{ $ifNull: ["$admin_reset_attempts", 0] }, 1] },
              ],
            },
            admin_reset_attempts_reset_at: {
              $cond: [
                {
                  $lte: [
                    {
                      $ifNull: ["$admin_reset_attempts_reset_at", new Date(0)],
                    },
                    attemptWindowStart,
                  ],
                },
                now,
                "$admin_reset_attempts_reset_at",
              ],
            },
          },
        },
      ],
      {
        returnDocument: "after",
        projection: { _id: 1, admin_reset_attempts: 1 },
      },
    );

    if (!attemptState) {
      return res.status(400).json({
        message: "Invalid or expired OTP.",
      });
    }

    const otpMatches = await bcrypt.compare(otp, otpRecord.otp);

    if (!otpMatches) {
      return res.status(400).json({
        message: "Invalid or expired OTP.",
      });
    }

    const consumedOTP = await OTP.findOneAndDelete({
      _id: otpRecord._id,
      email,
      purpose: "admin-forgot-password",
      otp: otpRecord.otp,
      expiresAt: { $gt: new Date() },
    });
    if (!consumedOTP) {
      return res.status(400).json({
        message: "Invalid or expired OTP.",
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const updatedAdmin = await User.findOneAndUpdate(
      { _id: attemptState._id, role: "admin" },
      {
        $set: { password_hash: passwordHash },
        $inc: { session_version: 1 },
      },
      { returnDocument: "after" },
    );
    if (!updatedAdmin) {
      return res.status(400).json({
        message: "Invalid password reset request.",
      });
    }

    return res.status(200).json({
      message: "Password reset successfully.",
    });
  } catch (error) {
    console.error("Admin reset password error:", error);

    return res.status(500).json({
      message: "Unable to reset password.",
    });
  }
};

// --- COUPON MANAGEMENT ---

/**
 * Create Coupon (Admin only)
 */
export const createCoupon = async (req, res) => {
  try {
    const {
      code,
      discount_percentage,
      max_discount,
      min_purchase,
      expires_at,
      active = true,
    } = req.body;

    if (!code || discount_percentage === undefined) {
      return res.status(400).json({
        message: "Coupon code and discount percentage are required.",
      });
    }

    const normalizedCode = String(code).trim().toUpperCase();

    if (!/^[A-Z0-9_-]+$/.test(normalizedCode)) {
      return res.status(400).json({
        message:
          "Coupon code can contain only letters, numbers, hyphens, and underscores.",
      });
    }

    const discount = Number(discount_percentage);
    const minPurchase = Number(min_purchase || 0);
    const maxDiscount =
      max_discount !== undefined && max_discount !== ""
        ? Number(max_discount)
        : undefined;

    if (!Number.isFinite(discount) || discount <= 0 || discount > 100) {
      return res.status(400).json({
        message: "Discount percentage must be between 1 and 100.",
      });
    }

    if (!Number.isFinite(minPurchase) || minPurchase < 0) {
      return res.status(400).json({
        message: "Minimum purchase cannot be negative.",
      });
    }

    if (
      maxDiscount !== undefined &&
      (!Number.isFinite(maxDiscount) || maxDiscount <= 0)
    ) {
      return res.status(400).json({
        message: "Maximum discount must be greater than 0.",
      });
    }

    let expiryDate = null;

    if (expires_at) {
      expiryDate = new Date(expires_at);

      if (Number.isNaN(expiryDate.getTime())) {
        return res.status(400).json({
          message: "Invalid expiry date.",
        });
      }

      if (expiryDate <= new Date()) {
        return res.status(400).json({
          message: "Expiry date must be in the future.",
        });
      }
    }

    const existingCoupon = await Coupon.findOne({
      code: normalizedCode,
    });

    if (existingCoupon) {
      return res.status(409).json({
        message: "A coupon with this code already exists.",
      });
    }

    const coupon = new Coupon({
      code: normalizedCode,
      discount_percentage: discount,
      max_discount: maxDiscount,
      min_purchase: minPurchase,
      active: active === true || active === "true",
      expires_at: expiryDate,
    });

    await coupon.save();

    return res.status(201).json({
      message: "Coupon created successfully.",
      coupon,
    });
  } catch (error) {
    console.error("Create coupon error:", error);

    return res.status(500).json({
      message: "Error creating coupon.",
    });
  }
};

/**
 * Get all Coupons (Admin only)
 */
export const getAdminCoupons = async (req, res) => {
  try {
    const coupons = await Coupon.find().sort({ created_at: -1 }).lean();

    const formattedCoupons = coupons.map((coupon) => ({
      ...coupon,
      id: coupon._id.toString(),
    }));

    return res.status(200).json(formattedCoupons);
  } catch (error) {
    console.error("Get admin coupons error:", error);

    return res.status(500).json({
      message: "Error retrieving coupons.",
    });
  }
};

/**
 * Toggle Coupon Active / Inactive (Admin only)
 */
export const toggleCouponStatus = async (req, res) => {
  try {
    const { couponId } = req.params;

    const coupon = await Coupon.findById(couponId);

    if (!coupon) {
      return res.status(404).json({
        message: "Coupon not found.",
      });
    }

    coupon.active = !coupon.active;

    await coupon.save();

    return res.status(200).json({
      message: coupon.active
        ? "Coupon activated successfully."
        : "Coupon deactivated successfully.",
      coupon,
    });
  } catch (error) {
    console.error("Toggle coupon status error:", error);

    return res.status(500).json({
      message: "Error updating coupon status.",
    });
  }
};

/**
 * Delete Coupon (Admin only)
 */
export const deleteCoupon = async (req, res) => {
  try {
    const { couponId } = req.params;

    const coupon = await Coupon.findByIdAndDelete(couponId);

    if (!coupon) {
      return res.status(404).json({
        message: "Coupon not found.",
      });
    }

    return res.status(200).json({
      message: "Coupon deleted successfully.",
    });
  } catch (error) {
    console.error("Delete coupon error:", error);

    return res.status(500).json({
      message: "Error deleting coupon.",
    });
  }
};
