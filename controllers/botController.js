const { processScreenshot } = require('../services/processingService');
const { resolveImageInput } = require('../services/imageService');

exports.receiveScreenshot = async (req, res) => {
  try {
    const {
      buffer,
      base64,
      filename,
      mimeType,
      telegramMeta,
      source,
    } = req.body;

    const {
      buffer: imageBuffer,
      mimeType: resolvedMimeType,
    } = resolveImageInput({
      buffer,
      base64,
      mimeType,
    });

    const result = await processScreenshot({
      buffer: imageBuffer,
      mimeType: resolvedMimeType,
      filename: filename || 'telegram_screenshot.jpg',
      source: source || 'telegram',
      telegramMeta: telegramMeta || {},
    });

    res.status(getResultStatusCode(result)).json(result);
  } catch (error) {
    const statusCode =
      error.message.includes('base64') ||
      error.message.includes('buffer')
        ? 400
        : 500;

    res.status(statusCode).json({ error: error.message });
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
