const sharp = require('sharp');
const crypto = require('crypto');

/**
 * Enhance image in memory
 */
const enhanceImage = async (imageBuffer) => {
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
  if (Buffer.isBuffer(buffer)) {
    return {
      buffer,
      mimeType: mimeType || 'image/jpeg',
    };
  }

  const base64Payload =
    typeof buffer === 'string'
      ? buffer
      : base64;

  const resolvedMimeType =
    mimeType ||
    extractMimeTypeFromBase64(base64Payload) ||
    'image/jpeg';

  return {
    buffer: base64ToBuffer(base64Payload),
    mimeType: resolvedMimeType,
  };
};

module.exports = {
  enhanceImage,
  computeImageHash,
  base64ToBuffer,
  extractMimeTypeFromBase64,
  resolveImageInput,
};