import { v2 as cloudinary } from "cloudinary";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import sharp from "sharp";

dotenv.config();

const cloudinaryEnabled =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET;

if (cloudinaryEnabled) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  console.log("Cloudinary Storage client initialized.");
} else {
  console.log(
    "Cloudinary credentials not found. Falling back to local storage uploads.",
  );
}

/**
 * Uploads a file (buffer) to Cloudinary or saves it locally if Cloudinary is not configured
 * @param {Buffer} fileBuffer - The buffer of the file
 * @param {string} fileName - Destination file name
 * @param {string} mimeType - The mime-type of the file
 * @returns {Promise<string>} - The URL of the uploaded asset
 */
export const uploadAsset = async (fileBuffer, fileName, mimeType) => {
  let processedBuffer = fileBuffer;
  let processedFileName = fileName;
  let processedMimeType = mimeType;

  // Convert JPG, JPEG, and PNG images to WebP
  if (mimeType && (mimeType === "image/jpeg" || mimeType === "image/png" || mimeType === "image/jpg")) {
    try {
      processedBuffer = await sharp(fileBuffer).webp({ quality: 80 }).toBuffer();
      processedMimeType = "image/webp";
      
      const ext = path.extname(fileName);
      if (ext) {
        processedFileName = fileName.slice(0, -ext.length) + ".webp";
      } else {
        processedFileName = fileName + ".webp";
      }
    } catch (err) {
      console.error("Error converting image to WebP with sharp:", err);
      // Fallback to original values on failure
      processedBuffer = fileBuffer;
      processedFileName = fileName;
      processedMimeType = mimeType;
    }
  }

  if (cloudinaryEnabled) {
    try {
      return await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: "bhatkar",
            resource_type: "auto",
          },
          (error, result) => {
            if (error) {
              console.error("Cloudinary stream upload error:", error);
              return reject(error);
            }
            resolve(result.secure_url);
          },
        );
        uploadStream.end(processedBuffer);
      });
    } catch (err) {
      console.error("Cloudinary upload error, trying local fallback:", err);
    }
  }

  // Local Storage Fallback
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const uploadDir = path.join(__dirname, "..", "public", "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const cleanFileName = `${Date.now()}_${processedFileName.replace(/[^a-zA-Z0-9._-]/g, "")}`;
    const filePath = path.join(uploadDir, cleanFileName);
    fs.writeFileSync(filePath, processedBuffer);

    const port = process.env.PORT || 5000;
    const backendUrl = process.env.BACKEND_URL || `http://localhost:${port}`;
    return `${backendUrl}/uploads/${cleanFileName}`;
  } catch (err) {
    console.error("Local file save error:", err);
    throw new Error("File upload failed.");
  }
};
