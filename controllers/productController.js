import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Review from '../models/Review.js';

/**
 * Get all products (with search, filtering, sorting, and pagination)
 */
export const getProducts = async (req, res) => {
  try {
    const {
      search,
      category,
      gender,
      priceMin,
      priceMax,
      rating,
      availability,
      sortBy,
      page = 1,
      limit = 10,
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const pipeline = [];
    
    // 1. Initial Match Stage
    const matchStage = {};
    if (search) {
      matchStage.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { short_description: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (gender) {
      matchStage.gender = gender;
    }
    
    if (rating) {
      matchStage.rating = { $gte: parseFloat(rating) };
    }
    
    if (availability === 'in-stock') {
      matchStage.stock_quantity = { $gt: 0 };
    }
    
    if (category) {
      const cat = await Category.findOne({ slug: category });
      if (cat) {
        matchStage.category_id = cat._id;
      } else {
        return res.status(200).json({
          products: [],
          pagination: {
            total: 0,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: 0,
          },
        });
      }
    }
    
    pipeline.push({ $match: matchStage });

    // 2. Project effective price to apply price filters
    pipeline.push({
      $project: {
        name: 1,
        slug: 1,
        short_description: 1,
        price: 1,
        sale_price: 1,
        stock_quantity: 1,
        category_id: 1,
        gender: 1,
        rating: 1,
        is_featured: 1,
        is_best_selling: 1,
        is_new_arrival: 1,
        fragrance_notes: 1,
        video_url: 1,
        images: 1,
        created_at: 1,
        updated_at: 1,
        effective_price: { $ifNull: ['$sale_price', '$price'] }
      }
    });

    // 3. Match effective price range
    const priceMatch = {};
    if (priceMin) priceMatch.effective_price = { $gte: parseFloat(priceMin) };
    if (priceMax) priceMatch.effective_price = { ...priceMatch.effective_price, $lte: parseFloat(priceMax) };
    if (priceMin || priceMax) {
      pipeline.push({ $match: priceMatch });
    }

    // 4. Total count estimation via duplicate pipeline
    const countPipeline = [...pipeline];
    countPipeline.push({ $count: 'total' });
    const countRes = await Product.aggregate(countPipeline);
    const totalProducts = countRes.length > 0 ? countRes[0].total : 0;

    // 5. Sorting Stage
    let sortStage = {};
    if (sortBy === 'price-asc') {
      sortStage.effective_price = 1;
    } else if (sortBy === 'price-desc') {
      sortStage.effective_price = -1;
    } else if (sortBy === 'latest') {
      sortStage.created_at = -1;
    } else if (sortBy === 'best-selling') {
      sortStage.is_best_selling = -1;
      sortStage.rating = -1;
    } else if (sortBy === 'popular') {
      sortStage.rating = -1;
    } else {
      sortStage.created_at = -1; // Default
    }
    pipeline.push({ $sort: sortStage });

    // 6. Pagination Stage
    pipeline.push({ $skip: offset });
    pipeline.push({ $limit: parseInt(limit) });

    // 7. Lookup Category details ONLY for the paginated subset of products
    pipeline.push({
      $lookup: {
        from: 'categories',
        localField: 'category_id',
        foreignField: '_id',
        as: 'category'
      }
    });

    pipeline.push({
      $unwind: {
        path: '$category',
        preserveNullAndEmptyArrays: true
      }
    });

    // 8. Final projection to reshape the output structure
    pipeline.push({
      $project: {
        id: '$_id',
        name: 1,
        slug: 1,
        short_description: 1,
        price: 1,
        sale_price: 1,
        stock_quantity: 1,
        category_id: 1,
        gender: 1,
        rating: 1,
        is_featured: 1,
        is_best_selling: 1,
        is_new_arrival: 1,
        fragrance_notes: 1,
        video_url: 1,
        created_at: 1,
        updated_at: 1,
        category_name: '$category.name',
        category_slug: '$category.slug',
        primary_image: {
          $let: {
            vars: {
              prim: {
                $filter: {
                  input: '$images',
                  as: 'img',
                  cond: { $eq: ['$$img.is_primary', true] }
                }
              }
            },
            in: {
              $ifNull: [
                { $arrayElemAt: ['$$prim.image_url', 0] },
                { $arrayElemAt: ['$images.image_url', 0] }
              ]
            }
          }
        }
      }
    });

    const products = await Product.aggregate(pipeline);

    res.status(200).json({
      products,
      pagination: {
        total: totalProducts,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(totalProducts / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ message: 'Error retrieving products.' });
  }
};

/**
 * Get single product by slug
 */
export const getProductBySlug = async (req, res) => {
  const { slug } = req.params;

  try {
    const product = await Product.findOne({ slug }).populate('category_id').lean();

    if (!product) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    const prodObj = {
      ...product,
      id: product._id.toString(),
      category_name: product.category_id?.name || null,
      category_slug: product.category_id?.slug || null,
      category_id: product.category_id?._id || null,
    };

    res.status(200).json(prodObj);
  } catch (error) {
    console.error('Error fetching product details:', error);
    res.status(500).json({ message: 'Error retrieving product details.' });
  }
};

/**
 * Get reviews for a product
 */
export const getProductReviews = async (req, res) => {
  const { productId } = req.params;

  try {
    const reviews = await Review.find({ product_id: productId })
      .populate('user_id', 'name')
      .sort({ created_at: -1 })
      .lean();

    const formattedReviews = reviews.map(r => ({
      ...r,
      id: r._id.toString(),
      user_name: r.user_id?.name || 'Anonymous'
    }));

    res.status(200).json(formattedReviews);
  } catch (error) {
    console.error('Error fetching product reviews:', error);
    res.status(500).json({ message: 'Error retrieving reviews.' });
  }
};

/**
 * Add review for a product (Verified users only)
 */
export const addProductReview = async (req, res) => {
  const { productId } = req.params;
  const { rating, title, comment } = req.body;
  const userId = req.user.id;

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ message: 'Rating must be between 1 and 5.' });
  }

  try {
    // Check if product exists
    const checkProduct = await Product.findById(productId);
    if (!checkProduct) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    // Check if user already reviewed, upsert
    await Review.updateOne(
      { product_id: productId, user_id: userId },
      { rating, title: title || '', comment: comment || '', created_at: new Date() },
      { upsert: true }
    );

    // Recalculate and update product rating average
    const avgRes = await Review.aggregate([
      { $match: { product_id: mongoose.Types.ObjectId.createFromHexString(productId) } },
      { $group: { _id: null, avg_rating: { $avg: '$rating' } } }
    ]);
    
    const newRating = avgRes.length > 0 ? parseFloat(avgRes[0].avg_rating.toFixed(2)) : 0.00;

    checkProduct.rating = newRating;
    await checkProduct.save();

    res.status(200).json({ message: 'Review submitted successfully.', rating: newRating });
  } catch (error) {
    console.error('Error adding product review:', error);
    res.status(500).json({ message: 'Error saving review.' });
  }
};
