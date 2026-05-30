const Transfer = require('../models/Transfer');
const { storeScreenshot, analyzeTransfer } = require('../services/processingService');
const { updateStatus } = require('../services/sheetsService');
const { resolveImageInput } = require('../services/imageService');
const { normalizeTelegramMeta } = require('../utils/telegramMeta');

const buildImageInput = (req) => {
  const { buffer, base64, filename, mimeType } = req.body;

  if (req.file) {
    return {
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      filename: req.file.originalname,
    };
  }

  return {
    ...resolveImageInput({ buffer, base64, mimeType }),
    filename: filename || 'api_upload.jpg',
  };
};

exports.getAll = async (req, res) => {
  try {
    const {
      status, method, search, startDate, endDate,
      page = 1, limit = 20, sort = '-createdAt',
    } = req.query;

    const filter = {};
    if (status && status !== 'all') filter.status = status;
    if (method) filter.paymentMethod = method;
    if (search) {
      filter.$or = [
        { senderName: { $regex: search, $options: 'i' } },
        { senderPhone: { $regex: search } },
        { transactionId: { $regex: search, $options: 'i' } },
        { receiverName: { $regex: search, $options: 'i' } },
      ];
    }
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate + 'T23:59:59');
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [transfers, total] = await Promise.all([
      Transfer.find(filter).sort(sort).skip(skip).limit(parseInt(limit)).lean(),
      Transfer.countDocuments(filter),
    ]);

    res.json({
      transfers,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    const statusCode =
      error.message.includes('base64') ||
      error.message.includes('buffer')
        ? 400
        : 500;

    res.status(statusCode).json({ error: error.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const transfer = await Transfer.findById(req.params.id).populate('verifiedBy', 'name email');
    if (!transfer) return res.status(404).json({ error: 'Transfer not found' });
    res.json({ transfer });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/** Phase 1 — save image quickly */
exports.upload = async (req, res) => {
  try {
    const { source, telegramMeta } = req.body;

    if (!req.file && !req.body.buffer && !req.body.base64) {
      return res.status(400).json({
        error: 'No image provided. Send multipart file or base64 payload.',
      });
    }

    const imageInput = buildImageInput(req);
    let meta = telegramMeta || {};
    if (typeof meta === 'string') {
      try { meta = JSON.parse(meta); } catch { meta = {}; }
    }

    const result = await storeScreenshot({
      buffer: imageInput.buffer,
      mimeType: imageInput.mimeType,
      filename: imageInput.filename,
      source: normalizeSource(source),
      telegramMeta: normalizeTelegramMeta(meta),
    });

    res.status(201).json(result);
  } catch (error) {
    if (error.name === 'ValidationError') {
      const details = Object.values(error.errors || {}).map((e) => e.message);
      return res.status(400).json({ error: 'Transfer validation failed', details });
    }

    console.error('Upload error:', error);
    res.status(500).json({ error: error.message || 'Failed to store screenshot' });
  }
};

/** Phase 2 — OCR + AI (long-running) */
exports.analyze = async (req, res) => {
  try {
    const result = await analyzeTransfer(req.params.id);
    const statusCode = result.transferId ? 200 : 422;
    res.status(statusCode).json(result);
  } catch (error) {
    if (error.message === 'Transfer not found') {
      return res.status(404).json({ error: error.message });
    }

    console.error('Analyze error:', error);
    res.status(500).json({ error: error.message || 'Analysis failed' });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { status, adminNotes } = req.body;
    const allowed = ['processing', 'pending', 'verified', 'suspicious', 'duplicate', 'failed_ocr'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const update = { status, adminNotes };
    if (status === 'verified') {
      update.verifiedBy = req.user._id;
      update.verifiedAt = new Date();
    }

    const transfer = await Transfer.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!transfer) return res.status(404).json({ error: 'Transfer not found' });

    if (transfer.sheetsRowIndex) {
      await updateStatus(transfer.sheetsRowIndex, status).catch(() => {});
    }

    res.json({ transfer });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteOne = async (req, res) => {
  try {
    const transfer = await Transfer.findByIdAndDelete(req.params.id);
    if (!transfer) return res.status(404).json({ error: 'Transfer not found' });
    res.json({ message: 'Transfer deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.bulkVerify = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });

    await Transfer.updateMany(
      { _id: { $in: ids } },
      { status: 'verified', verifiedBy: req.user._id, verifiedAt: new Date() }
    );

    res.json({ message: `${ids.length} transfers verified` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const normalizeSource = (value) => {
  const allowedSources = new Set(['telegram', 'whatsapp', 'manual', 'api', 'n8n']);
  return allowedSources.has(value) ? value : 'api';
};
