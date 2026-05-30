const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/transferController');
const { protect, adminOnly } = require('../middleware/auth');
const { protectOrBot } = require('../middleware/botAuth');
const { upload } = require('../middleware/upload');

const multerUpload = (req, res, next) => {
  upload.single('screenshot')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
};

router.get('/', protect, ctrl.getAll);
router.get('/:id', protect, ctrl.getOne);

router.post('/upload', protectOrBot, multerUpload, ctrl.upload);
router.post('/:id/analyze', protectOrBot, ctrl.analyze);

router.patch('/:id/status', protect, adminOnly, ctrl.updateStatus);
router.post('/bulk-verify', protect, adminOnly, ctrl.bulkVerify);
router.delete('/:id', protect, adminOnly, ctrl.deleteOne);

module.exports = router;
