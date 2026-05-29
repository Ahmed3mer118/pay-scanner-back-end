const { processScreenshot } = require('../services/processingService');
const { resolveImageInput } = require('../services/imageService');

exports.receiveScreenshot = async (req, res) => {
  try {
    console.log('[bot] content-type:', req.headers['content-type']);
    console.log('[bot] req.file:', req.file ? { fieldname: req.file.fieldname, size: req.file.size } : null);
    console.log('[bot] body keys:', Object.keys(req.body));
    console.log('[bot] buffer?', !!req.body.buffer, '| base64?', !!req.body.base64, '| base64 length:', req.body.base64?.length);

    const {
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
    let resolvedMimeType;

    if (req.file) {
      imageBuffer = req.file.buffer;
      resolvedMimeType = req.file.mimetype;
    } else {
      ({ buffer: imageBuffer, mimeType: resolvedMimeType } = resolveImageInput({
        buffer,
        base64,
        mimeType,
      }));
    }

    if (!imageBuffer) {
      return res.status(400).json({ error: 'No image provided.' });
    }

    const result = await processScreenshot({
      buffer: imageBuffer,
      mimeType: resolvedMimeType || 'image/jpeg',
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
