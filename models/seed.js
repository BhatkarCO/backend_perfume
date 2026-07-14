import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

// Import Models
import User from './User.js';
import Category from './Category.js';
import Product from './Product.js';
import Coupon from './Coupon.js';
import Review from './Review.js';
import Wishlist from './Wishlist.js';
import Address from './Address.js';
import Payment from './Payment.js';
import Order from './Order.js';
import InventoryLog from './InventoryLog.js';
import NewsletterSubscriber from './NewsletterSubscriber.js';
import ContactMessage from './ContactMessage.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bhatkarbase';

const seedDatabase = async () => {
  console.log('Connecting to MongoDB for seeding...');
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('MongoDB Connected.');

    // 0. Drop existing collections to ensure clean seed
    console.log('Dropping old collections...');
    await User.deleteMany({});
    await Category.deleteMany({});
    await Product.deleteMany({});
    await Coupon.deleteMany({});
    await Review.deleteMany({});
    await Wishlist.deleteMany({});
    await Address.deleteMany({});
    await Payment.deleteMany({});
    await Order.deleteMany({});
    await InventoryLog.deleteMany({});
    await NewsletterSubscriber.deleteMany({});
    await ContactMessage.deleteMany({});
    console.log('Old collections dropped.');

    // 1. Seed Users
    console.log('Seeding users...');
    const adminPasswordHash = await bcrypt.hash('AdminPass123', 10);
    const userPasswordHash = await bcrypt.hash('UserPass123', 10);

    const adminUser = new User({
      email: 'admin@bhatkar-perfumes.com',
      password_hash: adminPasswordHash,
      role: 'admin',
      name: 'Bhatkar & Co. Admin',
      phone: '+919999999999',
      is_verified: true
    });
    await adminUser.save();

    const regularUser = new User({
      email: 'user@bhatkar-perfumes.com',
      password_hash: userPasswordHash,
      role: 'user',
      name: 'Rohan Bhatkar',
      phone: '+919876543210',
      is_verified: true
    });
    await regularUser.save();

    console.log(`Admin user (ID: ${adminUser.id}) and regular user (ID: ${regularUser.id}) created.`);

    // 2. Seed Categories
    console.log('Seeding categories...');
    const categoriesData = [
      { name: 'Signature Collection', slug: 'signature-collection', description: 'Exclusive signature fragrances from Bhatkar & Co.', image_url: 'https://images.unsplash.com/photo-1594035910387-fea47794261f?w=600&auto=format&fit=crop' },
      { name: 'Fresh Collection', slug: 'fresh-collection', description: 'Light, refreshing scents perfect for daily wear.', image_url: 'https://images.unsplash.com/photo-1541643600914-78b084683601?w=600&auto=format&fit=crop' },
      { name: 'Floral Collection', slug: 'floral-collection', description: 'Sophisticated floral fragrances.', image_url: 'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?w=600&auto=format&fit=crop' },
      { name: 'Woody Collection', slug: 'woody-collection', description: 'Warm, woody and earthy tones.', image_url: 'https://images.unsplash.com/photo-1595425970377-c9703cf48b6d?w=600&auto=format&fit=crop' },
      { name: 'Luxury Collection', slug: 'luxury-collection', description: 'Concentrated and rich luxury perfume oils and attars.', image_url: 'https://images.unsplash.com/photo-1594035910387-fea47794261f?w=600&auto=format&fit=crop' },
      { name: 'Gift Sets', slug: 'gift-sets', description: 'Curated premium perfume gift boxes.', image_url: 'https://images.unsplash.com/photo-1523293182086-7651a899d37f?w=600&auto=format&fit=crop' }
    ];

    const categoryIds = {};
    for (const cat of categoriesData) {
      const newCat = new Category(cat);
      await newCat.save();
      categoryIds[newCat.slug] = newCat._id;
    }
    console.log('Categories seeded.');

    // 3. Seed Products
    console.log('Seeding products...');
    const productsData = [
      {
        name: 'Oud Royale',
        slug: 'oud-royale',
        description: 'An intense, dark blend of rich Cambodian oud, combined with tobacco, warm spices, and leather. Created for those who command respect. Features a deeply complex scent profile that lingers throughout the night.',
        short_description: 'An intense blend of rich Cambodian oud, warm spices, and leather.',
        price: 3499.00,
        sale_price: 2999.00,
        stock_quantity: 45,
        category_id: categoryIds['signature-collection'],
        gender: 'Men',
        rating: 4.8,
        is_featured: true,
        is_best_selling: true,
        is_new_arrival: false,
        fragrance_notes: {
          top: ['Saffron', 'Nutmeg', 'Lavender'],
          heart: ['Agarwood (Oud)', 'Patchouli'],
          base: ['Musk', 'Leather', 'Sandalwood']
        },
        images: [
          { image_url: 'https://images.unsplash.com/photo-1594035910387-fea47794261f?w=600&auto=format&fit=crop', is_primary: true },
          { image_url: 'https://images.unsplash.com/photo-1523293182086-7651a899d37f?w=600&auto=format&fit=crop', is_primary: false }
        ]
      },
      {
        name: 'Imperial Rose',
        slug: 'imperial-rose',
        description: 'A contemporary floral masterpiece centering around Turkish Rose, fresh lychee, pear, and vetiver. Accented with white musk and dry woods. Soft, sophisticated, yet undeniably regal.',
        short_description: 'A contemporary floral masterpiece with Turkish Rose, fresh lychee, and pear.',
        price: 2899.00,
        sale_price: 2499.00,
        stock_quantity: 30,
        category_id: categoryIds['floral-collection'],
        gender: 'Women',
        rating: 4.6,
        is_featured: true,
        is_best_selling: false,
        is_new_arrival: true,
        fragrance_notes: {
          top: ['Lychee', 'Pear', 'Bergamot'],
          heart: ['Turkish Rose', 'Incense', 'Oud'],
          base: ['Vanilla', 'Amber', 'Woody Notes']
        },
        images: [
          { image_url: 'https://images.unsplash.com/photo-1615655096345-61a54750068d?w=600&auto=format&fit=crop', is_primary: true },
          { image_url: 'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?w=600&auto=format&fit=crop', is_primary: false }
        ]
      },
      {
        name: 'Santal Blanc',
        slug: 'santal-blanc',
        description: 'A clean, creamy sandalwood fragrance layered with green cardamom, violet leaves, iris, and leather. Warm and comforting, it mimics the velvety softness of raw wood in the sunlight.',
        short_description: 'A clean, creamy sandalwood fragrance with cardamom and leather.',
        price: 2299.00,
        sale_price: 1999.00,
        stock_quantity: 60,
        category_id: categoryIds['woody-collection'],
        gender: 'Unisex',
        rating: 4.5,
        is_featured: false,
        is_best_selling: true,
        is_new_arrival: false,
        fragrance_notes: {
          top: ['Cardamom', 'Violet Leaf', 'Iris'],
          heart: ['Papyrus', 'Amber', 'Leather'],
          base: ['Sandalwood', 'Cedarwood', 'Musk']
        },
        images: [
          { image_url: 'https://images.unsplash.com/photo-1541643600914-78b084683601?w=600&auto=format&fit=crop', is_primary: true },
          { image_url: 'https://images.unsplash.com/photo-1595425970377-c9703cf48b6d?w=600&auto=format&fit=crop', is_primary: false }
        ]
      },
      {
        name: 'Citrus Breeze',
        slug: 'citrus-breeze',
        description: 'An invigorating blast of sea breeze blended with Sicilian orange, lemon zest, vetiver, and cooling mint. Perfect for active days or hot summer afternoons.',
        short_description: 'An invigorating blast of sea breeze, Sicilian orange, and mint.',
        price: 1799.00,
        sale_price: 1599.00,
        stock_quantity: 15,
        category_id: categoryIds['fresh-collection'],
        gender: 'Men',
        rating: 4.3,
        is_featured: false,
        is_best_selling: false,
        is_new_arrival: true,
        fragrance_notes: {
          top: ['Lemon Zest', 'Grapefruit', 'Mint'],
          heart: ['Sea Salt', 'Ginger', 'Jasmine'],
          base: ['Vetiver', 'Oakmoss', 'Cedar']
        },
        images: [
          { image_url: 'https://images.unsplash.com/photo-1595425970377-c9703cf48b6d?w=600&auto=format&fit=crop', is_primary: true }
        ]
      },
      {
        name: 'Golden Amber Attar',
        slug: 'golden-amber-attar',
        description: 'Pure, concentrated perfume oil highlighting warm amber, sweet labdanum, vanilla, and heavy spices. Alcohol-free, this attar reacts with your skin heat to radiate a rich scent bubble.',
        short_description: 'Pure, concentrated perfume oil of warm amber, vanilla, and spices.',
        price: 1299.00,
        sale_price: null,
        stock_quantity: 80,
        category_id: categoryIds['luxury-collection'],
        gender: 'Unisex',
        rating: 4.7,
        is_featured: true,
        is_best_selling: true,
        is_new_arrival: false,
        fragrance_notes: {
          top: ['Clove', 'Cinnamon'],
          heart: ['Labdanum', 'Benzoin', 'Rose'],
          base: ['Amber', 'Vanilla', 'Patchouli']
        },
        images: [
          { image_url: 'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?w=600&auto=format&fit=crop', is_primary: true }
        ]
      },
      {
        name: 'Velvet Vanilla Solid',
        slug: 'velvet-vanilla-solid',
        description: 'A wax-based, portable perfume solid. Rich Madagascar vanilla, whipped cream, and soft orchid notes melt into the skin for a subtle, sweet, long-lasting aura.',
        short_description: 'A wax-based, portable perfume solid of Madagascar vanilla.',
        price: 799.00,
        sale_price: 699.00,
        stock_quantity: 120,
        category_id: categoryIds['gift-sets'],
        gender: 'Women',
        rating: 4.4,
        is_featured: false,
        is_best_selling: false,
        is_new_arrival: false,
        fragrance_notes: {
          top: ['Coconut Milk', 'Helichrysum'],
          heart: ['Vanilla Orchid', 'Almond'],
          base: ['Vanilla Bean', 'Brown Sugar', 'Musk']
        },
        images: [
          { image_url: 'https://images.unsplash.com/photo-1523293182086-7651a899d37f?w=600&auto=format&fit=crop', is_primary: true }
        ]
      }
    ];

    const productMap = {};
    for (const prod of productsData) {
      const newProd = new Product(prod);
      await newProd.save();
      productMap[newProd.slug] = newProd._id;

      // Log initial inventory
      const log = new InventoryLog({
        product_id: newProd._id,
        change_amount: newProd.stock_quantity,
        reason: 'Initial seed stock'
      });
      await log.save();
    }
    console.log('Products seeded.');

    // 4. Seed Coupons
    console.log('Seeding coupons...');
    const couponsData = [
      { code: 'SCENT10', discount_percentage: 10.00, max_discount: 500.00, min_purchase: 1000.00, expires_at: new Date('2027-12-31T23:59:59') },
      { code: 'WELCOME20', discount_percentage: 20.00, max_discount: 1000.00, min_purchase: 1500.00, expires_at: new Date('2027-12-31T23:59:59') },
      { code: 'GOLDEN30', discount_percentage: 30.00, max_discount: 2000.00, min_purchase: 3000.00, expires_at: new Date('2027-12-31T23:59:59') }
    ];

    for (const coup of couponsData) {
      const newCoup = new Coupon(coup);
      await newCoup.save();
    }
    console.log('Coupons seeded.');

    // 5. Seed Reviews
    console.log('Seeding reviews...');
    if (productMap['oud-royale'] && regularUser._id) {
      const r1 = new Review({
        product_id: productMap['oud-royale'],
        user_id: regularUser._id,
        rating: 5,
        title: 'Masterpiece Scent',
        comment: 'This is by far the best oud fragrance I have owned. Lasts all day and leaves an incredible scent trail.'
      });
      await r1.save();

      const r2 = new Review({
        product_id: productMap['oud-royale'],
        user_id: regularUser._id,
        rating: 4,
        title: 'Very Rich and Intense',
        comment: 'Very luxury packaging and smell. It is extremely strong, so just 2 sprays are enough.'
      });
      await r2.save();
    }

    if (productMap['imperial-rose'] && regularUser._id) {
      const r3 = new Review({
        product_id: productMap['imperial-rose'],
        user_id: regularUser._id,
        rating: 5,
        title: 'Simply Divine',
        comment: 'Smells like fresh luxury roses with a hint of lychee sweetness. Highly recommend!'
      });
      await r3.save();

      const r4 = new Review({
        product_id: productMap['imperial-rose'],
        user_id: regularUser._id,
        rating: 4,
        title: 'Very feminine and long-lasting',
        comment: 'Love the bottle and the scent. Got so many compliments in the office.'
      });
      await r4.save();
    }
    console.log('Reviews seeded.');

    console.log('Database seeding completed successfully!');
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

seedDatabase();
