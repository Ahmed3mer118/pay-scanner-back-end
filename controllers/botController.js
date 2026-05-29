const fetch = require('node-fetch');
const { processScreenshot } = require('../services/processingService');
const { resolveImageInput } = require('../services/imageService');

exports.receiveScreenshot = async (req, res) => {
  try {
    const {
      filePath,
      buffer,
      base64,
      filename,
      mimeType,
      source,
    } = req.body;

    let telegramMeta = req.body.telegramMeta;
    if (typeof telegramMeta === 'string') {
      try { telegramMeta = JSON.parse(telegramMeta); } catch { telegramMeta = {}; }
    }

    let imageBuffer;
    let resolvedMimeType = mimeType || 'image/jpeg';

    if (req.file) {
      imageBuffer = req.file.buffer;
      resolvedMimeType = req.file.mimetype;
    } else if (filePath) {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN not set' });
      const telegramUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
      const response = await fetch(telegramUrl);
      if (!response.ok) return res.status(502).json({ error: 'Failed to download image from Telegram' });
      imageBuffer = Buffer.from(await response.arrayBuffer());
    } else {
      ({ buffer: imageBuffer, mimeType: resolvedMimeType } = resolveImageInput({ buffer, base64, mimeType }));
    }

    if (!imageBuffer) {
      return res.status(400).json({ error: 'No image provided.' });
    }

    const result = await processScreenshot({
      buffer: imageBuffer,
      mimeType: resolvedMimeType,
      filename: req.file?.originalname || filename || 'telegram_screenshot.jpg',
      source: source || 'telegram',
      telegramMeta: telegramMeta || {},
    });

    res.status(getResultStatusCode(result)).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getResultStatusCode = (result) => {
  if (result.success) {
    return 201;
  }

  if (result.status === 'duplicate') {
    return 409;
  }

  if (result.status === 'failed_ocr') {
    return 422;
  }

  return 200;
};
