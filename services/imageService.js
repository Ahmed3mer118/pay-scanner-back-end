const sharp = require('sharp');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/**
 * Enhance image for better OCR accuracy
 */
const enhanceImage = async (inputPath) => {
  const filename = `enhanced_${Date.now()}.png`;
  const outputPath = path.join(UPLOAD_DIR, filename);

  await sharp(inputPath)
    .resize({ width: 1200, withoutEnlargement: false })
    .greyscale()
    .normalize()
    .sharpen({ sigma: 1.5 })
    .linear(1.2, -20)    // increase contrast
    .png({ quality: 100 })
    .toFile(outputPath);

  return { outputPath, filename };
};

/**
 * Compute MD5 hash of image buffer for duplicate detection
 */
const computeImageHash = (buffer) => {
  return crypto.createHash('md5').update(buffer).digest('hex');
};

/**
 * Save raw uploaded buffer to disk
 */
const saveBuffer = async (buffer, originalName = 'screenshot') => {
  const ext = path.extname(originalName) || '.jpg';
  const filename = `raw_${Date.now()}${ext}`;
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, buffer);
  return { filePath, filename };
};

/**
 * Clean up temporary files
 */
const cleanupFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.warn('Cleanup warning:', e.message);
  }
};

module.exports = { enhanceImage, computeImageHash, saveBuffer, cleanupFile };
