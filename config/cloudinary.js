const { v2: cloudinary } = require('cloudinary');

const REQUIRED_ENV_VARS = [
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
];

const isCloudinaryConfigured = REQUIRED_ENV_VARS.every(
  (key) => Boolean(process.env[key])
);

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

const assertCloudinaryConfigured = () => {
  if (!isCloudinaryConfigured) {
    throw new Error(
      `Missing Cloudinary configuration. Required env vars: ${REQUIRED_ENV_VARS.join(', ')}`
    );
  }
};

module.exports = {
  cloudinary,
  isCloudinaryConfigured,
  assertCloudinaryConfigured,
};
