const multer = require('multer');
const path = require('path');

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const isOctetStream = file.mimetype === 'application/octet-stream' && ALLOWED_EXTENSIONS.includes(ext);
  if (!ALLOWED_TYPES.includes(file.mimetype) && !isOctetStream) {
    return cb(new Error('Only image files are allowed (JPEG, PNG, WEBP, GIF)'), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE },
});

module.exports = { upload };
