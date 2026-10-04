import multer from 'multer';
import sharp from "sharp";

// Multer Memory Storage Configuration
const storage = multer.memoryStorage();

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

// File filter to allow only image files
const fileFilter = (req, file, cb) => {
  if (allowedMimeTypes.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Invalid file type. Only JPEG, PNG, and WebP images are allowed.",
      ),
      false,
    );
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_DIMENSION = 8000;

export const isSafeProductImage = async (buffer) => {
  try {
    const metadata = await sharp(buffer, {
      limitInputPixels: MAX_IMAGE_PIXELS,
      pages: 1,
    }).metadata();

    return (
      ["jpeg", "png", "webp"].includes(metadata.format) &&
      Number.isInteger(metadata.width) &&
      Number.isInteger(metadata.height) &&
      metadata.width <= MAX_IMAGE_DIMENSION &&
      metadata.height <= MAX_IMAGE_DIMENSION &&
      metadata.width * metadata.height <= MAX_IMAGE_PIXELS &&
      (metadata.pages || 1) === 1
    );
  } catch {
    return false;
  }
};

export default upload;
