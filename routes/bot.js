const express = require('express');
const router = express.Router();
const { receiveScreenshot } = require('../controllers/botController');

// Internal bot endpoint — secured by bot secret header
router.post('/screenshot', (req, res, next) => {
  const secret = req.headers['x-bot-secret'];
  if (secret !== process.env.JWT_SECRET) {
    return res.status(401).json({ error: 'Unauthorized bot request' });
  }
  next();
}, receiveScreenshot);

module.exports = router;
