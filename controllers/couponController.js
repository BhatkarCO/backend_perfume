import Coupon from "../models/Coupon.js";

export const getActiveCoupons = async (req, res) => {
  try {
    const coupons = await Coupon.find({
      active: true,
      $or: [
        { expires_at: null },
        { expires_at: { $gt: new Date() } },
      ],
    })
      .select(
        "code discount_percentage max_discount min_purchase expires_at"
      )
      .sort({ created_at: -1 })
      .limit(5)
      .lean();

    return res.status(200).json(coupons);
  } catch (error) {
    console.error("Get active coupons error:", error);

    return res.status(500).json({
      message: "Failed to load active coupons.",
    });
  }
};