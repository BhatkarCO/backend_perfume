import Wishlist from '../models/Wishlist.js';
import Product from '../models/Product.js';

/**
 * Get current user's wishlist
 */
export const getUserWishlist = async (req, res) => {
  const userId = req.user.id;

  try {
    const wishlistItems = await Wishlist.find({ user_id: userId })
      .populate({
        path: 'product_id',
        populate: { path: 'category_id' }
      })
      .sort({ created_at: -1 })
      .lean();

    const formattedWishlist = wishlistItems
      .filter(item => item.product_id) // Filter out null/deleted products
      .map(item => {
        const prod = item.product_id;
        
        // Find primary image or use the first image fallback
        const primaryImage = prod.images?.find(img => img.is_primary)?.image_url 
          || (prod.images?.[0]?.image_url || null);

        return {
          ...prod,
          id: prod._id.toString(),
          wishlist_item_id: item._id.toString(),
          category_name: prod.category_id?.name || null,
          primary_image: primaryImage
        };
      });

    res.status(200).json(formattedWishlist);
  } catch (error) {
    console.error('Error fetching wishlist:', error);
    res.status(500).json({ message: 'Error retrieving wishlist.' });
  }
};

/**
 * Add product to wishlist
 */
export const addToWishlist = async (req, res) => {
  const userId = req.user.id;
  const { productId } = req.body;

  if (!productId) {
    return res.status(400).json({ message: 'Product ID is required.' });
  }

  try {
    // Check if product exists
    const checkProduct = await Product.findById(productId);
    if (!checkProduct) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    // Add to wishlist if not already there (upsert)
    await Wishlist.updateOne(
      { user_id: userId, product_id: productId },
      { $setOnInsert: { user_id: userId, product_id: productId } },
      { upsert: true }
    );

    res.status(200).json({ message: 'Product added to wishlist.' });
  } catch (error) {
    console.error('Error adding to wishlist:', error);
    res.status(500).json({ message: 'Error updating wishlist.' });
  }
};

/**
 * Remove product from wishlist
 */
export const removeFromWishlist = async (req, res) => {
  const userId = req.user.id;
  const { productId } = req.params;

  try {
    await Wishlist.deleteOne({ user_id: userId, product_id: productId });
    res.status(200).json({ message: 'Product removed from wishlist.' });
  } catch (error) {
    console.error('Error removing from wishlist:', error);
    res.status(500).json({ message: 'Error updating wishlist.' });
  }
};
