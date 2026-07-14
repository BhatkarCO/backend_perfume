import Category from '../models/Category.js';
import Product from '../models/Product.js';

/**
 * Get all categories
 */
export const getCategories = async (req, res) => {
  try {
    // 1. Fetch category product counts in a single aggregation query
    const counts = await Product.aggregate([
      { $group: { _id: '$category_id', count: { $sum: 1 } } }
    ]);
    
    const countMap = {};
    counts.forEach(c => {
      if (c._id) {
        countMap[c._id.toString()] = c.count;
      }
    });

    // 2. Fetch categories with lean configuration
    const categories = await Category.find().sort({ name: 1 }).lean();
    
    // 3. Map categories with count and map id virtual string
    const categoriesWithCount = categories.map((cat) => ({
      ...cat,
      id: cat._id.toString(),
      product_count: countMap[cat._id.toString()] || 0
    }));

    res.status(200).json(categoriesWithCount);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ message: 'Error retrieving categories.' });
  }
};
