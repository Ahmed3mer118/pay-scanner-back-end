const express = require('express');
const router = express.Router();
const { receiveScreenshot, analyzeScreenshot } = require('../controllers/botController');
const { upload } = require('../middleware/upload');
const { getBotSecret } = require('../middleware/botAuth');

const botAuth = (req, res, next) => {
  const secret = req.headers['x-bot-secret'];
  const expected = getBotSecret();

  if (!expected || secret !== expected) {
    return res.status(401).json({ error: 'Unauthorized bot request' });
  }

  next();
};

const multerUpload = (req, res, next) => {
  upload.single('screenshot')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
};

router.post('/screenshot', botAuth, multerUpload, receiveScreenshot);
router.post('/analyze/:id', botAuth, analyzeScreenshot);

module.exports = router;
