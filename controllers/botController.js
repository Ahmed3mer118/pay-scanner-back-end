const fetch = require('node-fetch');
const { storeScreenshot, analyzeTransfer } = require('../services/processingService');
const { resolveImageInput } = require('../services/imageService');
const { normalizeTelegramMeta } = require('../utils/telegramMeta');

const resolveImageBuffer = async (req) => {
  const { filePath, buffer, base64, mimeType } = req.body;

  if (req.file) {
    return {
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      filename: req.file.originalname,
    };
  }

  if (filePath) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');
    const telegramUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
    const response = await fetch(telegramUrl);
    if (!response.ok) throw new Error('Failed to download image from Telegram');
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mimeType: mimeType || 'image/jpeg',
      filename: 'telegram_screenshot.jpg',
    };
  }

  const resolved = resolveImageInput({ buffer, base64, mimeType });
  return {
    buffer: resolved.buffer,
    mimeType: resolved.mimeType,
    filename: 'telegram_screenshot.jpg',
  };
};

exports.receiveScreenshot = async (req, res) => {
  try {
    const { source, telegramMeta, analyze } = req.query;
    const shouldAnalyze = analyze !== '0' && analyze !== 'false';

    const image = await resolveImageBuffer(req);
    if (!image.buffer) {
      return res.status(400).json({ error: 'No image provided.' });
    }

    let meta = req.body.telegramMeta || {};
    if (typeof meta === 'string') {
      try { meta = JSON.parse(meta); } catch { meta = {}; }
    }

    const stored = await storeScreenshot({
      buffer: image.buffer,
      mimeType: image.mimeType,
      filename: image.filename,
      source: source || 'telegram',
      telegramMeta: normalizeTelegramMeta(meta),
    });

    if (!shouldAnalyze) {
      return res.status(201).json(stored);
    }

    const result = await analyzeTransfer(stored.transferId);
    res.status(getResultStatusCode(result)).json(result);
  } catch (error) {
    console.error('Bot screenshot error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.analyzeScreenshot = async (req, res) => {
  try {
    const result = await analyzeTransfer(req.params.id);
    res.status(getResultStatusCode(result)).json(result);
  } catch (error) {
    if (error.message === 'Transfer not found') {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
};

const getResultStatusCode = (result) => {
  if (result.success && result.transferId) return 201;
  if (result.status === 'failed_ocr') return 422;
  return 200;
};
