const { processScreenshot } = require('../services/processingService');

exports.receiveScreenshot = async (req, res) => {
  try {
    const { buffer, filename, telegramMeta } = req.body;

    if (!buffer) return res.status(400).json({ error: 'No image buffer provided' });

    const imageBuffer = Buffer.from(buffer, 'base64');

    const result = await processScreenshot({
      buffer: imageBuffer,
      filename: filename || 'telegram_screenshot.jpg',
      source: 'telegram',
      telegramMeta: telegramMeta || {},
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
