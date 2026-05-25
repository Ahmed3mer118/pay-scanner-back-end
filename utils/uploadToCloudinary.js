const path = require('path');
const crypto = require('crypto');

const {
  cloudinary,
  assertCloudinaryConfigured,
} = require('../config/cloudinary');

const DEFAULT_FOLDER = process.env.CLOUDINARY_UPLOAD_FOLDER || 'payscanner/transfers';

const sanitizePublicId = (value) => value
  .toLowerCase()
  .replace(/[^a-z0-9_-]+/g, '-')
  .replace(/-{2,}/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 60);

const buildPublicId = (filename = 'transfer-image') => {
  const basename = path.parse(filename).name || 'transfer-image';
  const sanitized = sanitizePublicId(basename) || 'transfer-image';

  return `${sanitized}-${crypto.randomUUID().slice(0, 8)}`;
};

const isCloudinaryDeletable = (publicId) => typeof publicId === 'string' && publicId.trim().length > 0;

const uploadBufferToCloudinary = async ({
  buffer,
  filename,
  folder = DEFAULT_FOLDER,
}) => {
  assertCloudinaryConfigured();

  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('Cloudinary upload requires a non-empty image buffer.');
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: buildPublicId(filename),
        resource_type: 'image',
        overwrite: false,
        format: 'png',
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }

        return resolve(result);
      }
    );

    uploadStream.on('error', reject);
    uploadStream.end(buffer);
  });
};

const deleteCloudinaryAsset = async (publicId) => {
  if (!publicId || !isCloudinaryDeletable(publicId)) {
    return;
  }

  assertCloudinaryConfigured();
  await cloudinary.uploader.destroy(publicId, {
    resource_type: 'image',
    invalidate: true,
  });
};

module.exports = {
  uploadBufferToCloudinary,
  deleteCloudinaryAsset,
};
