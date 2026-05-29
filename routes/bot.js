const express = require('express');
const router = express.Router();
const { receiveScreenshot } = require('../controllers/botController');
const { upload } = require('../middleware/upload');

const botAuth = (req, res, next) => {
  const secret = req.headers['x-bot-secret'];
  if (secret !== process.env.JWT_SECRET) {
    return res.status(401).json({ error: 'Unauthorized bot request' });
  }
  next();
};

router.post('/screenshot', botAuth, upload.single('screenshot'), receiveScreenshot);

module.exports = router;
