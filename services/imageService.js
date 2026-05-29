const sharp = require('sharp');
const crypto = require('crypto');

/**
 * Enhance image in memory
 */
const enhanceImage = async (imageBuffer) => {

  const metadata = await sharp(imageBuffer).metadata();

  if (!metadata.format) {
    throw new Error('Unsupported image format');
  }

  const enhancedBuffer = await sharp(imageBuffer)
    .rotate()
    .resize({
      width: 1200,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .greyscale()
    .normalize()
    .sharpen({ sigma: 1.5 })
    .linear(1.2, -20)
    .png()
    .toBuffer();

  return enhancedBuffer;
};
/**
 * Generate image hash
 */
const computeImageHash = (buffer) => {
  return crypto
    .createHash('md5')
    .update(buffer)
    .digest('hex');
};

/**
 * Convert base64 to buffer
 */
const base64ToBuffer = (base64) => {
  if (Buffer.isBuffer(base64)) {
    return base64;
  }

  if (typeof base64 !== 'string' || !base64.trim()) {
    throw new Error('A base64 image payload is required.');
  }

  const sanitizedBase64 = base64
    .trim()
    .replace(/^data:[^;]+;base64,/, '')
    .replace(/\s/g, '');

  if (!/^[A-Za-z0-9+/=]+$/.test(sanitizedBase64)) {
    throw new Error('Invalid base64 image payload.');
  }

  const buffer = Buffer.from(sanitizedBase64, 'base64');

  if (!buffer.length) {
    throw new Error('Decoded image buffer is empty.');
  }

  return buffer;
};

/**
 * Extract mime type from a data URI if present
 */
const extractMimeTypeFromBase64 = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.match(/^data:([^;]+);base64,/i);
  return match ? match[1].toLowerCase() : null;
};

/**
 * Normalize buffer/base64 payloads into a single in-memory shape
 */
const resolveImageInput = ({
  buffer,
  base64,
  mimeType,
}) => {

  const imageData = buffer || base64;

  if (!imageData) {
    throw new Error('No valid image payload provided');
  }

  if (Buffer.isBuffer(imageData)) {
    if (imageData.length < 100) {
      throw new Error('Decoded image is too small or invalid');
    }
    return {
      buffer: imageData,
      mimeType: mimeType || 'image/jpeg',
    };
  }

  if (typeof imageData !== 'string') {
    throw new Error('No valid image payload provided');
  }

  const cleanedBase64 = imageData
    .replace(/^data:image\/\w+;base64,/, '')
    .replace(/\s/g, '');

  if (!/^[A-Za-z0-9+/]+=*$/.test(cleanedBase64)) {
    throw new Error(
      'Invalid image payload: expected a base64-encoded image, got an unrecognized string. ' +
      'If using n8n, make sure to send the binary file directly (multipart) or convert it to base64 first.'
    );
  }

  let imageBuffer;

  try {
    imageBuffer = Buffer.from(cleanedBase64, 'base64');
  } catch (e) {
    throw new Error('Base64 decoding failed');
  }

  if (!imageBuffer || imageBuffer.length < 100) {
    throw new Error('Decoded image is too small or invalid');
  }

  return {
    buffer: imageBuffer,
    mimeType: mimeType || 'image/jpeg',
  };
};
module.exports = {
  enhanceImage,
  computeImageHash,
  base64ToBuffer,
  extractMimeTypeFromBase64,
  resolveImageInput,
};