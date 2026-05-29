const Transfer = require('../models/Transfer');
const { processScreenshot } = require('../services/processingService');
const { updateStatus } = require('../services/sheetsService');
const { resolveImageInput } = require('../services/imageService');

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

exports.upload = async (req, res) => {
  try {
    const {
      buffer,
      base64,
      filename,
      mimeType,
      source,
      telegramMeta,
    } = req.body;

    if (!req.file && !buffer && !base64) {
      return res.status(400).json({
        error: 'No image provided. Send multipart file or base64 payload.',
      });
    }

    const imageInput = req.file
      ? {
          buffer: req.file.buffer,
          mimeType: req.file.mimetype,
          filename: req.file.originalname,
        }
      : {
          ...resolveImageInput({
            buffer,
            base64,
            mimeType,
          }),
          filename: filename || 'api_upload.jpg',
        };

    const result = await processScreenshot({
      buffer: imageInput.buffer,
      mimeType: imageInput.mimeType,
      filename: imageInput.filename,
      source: normalizeSource(source),
      telegramMeta: telegramMeta || {},
    });

    const statusCode = result.success ? 201 : result.status === 'duplicate' ? 409 : 422;
    res.status(statusCode).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { status, adminNotes } = req.body;
    const allowed = ['pending', 'verified', 'suspicious', 'duplicate', 'failed_ocr'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const update = { status, adminNotes };
    if (status === 'verified') {
      update.verifiedBy = req.user._id;
      update.verifiedAt = new Date();
    }

    const transfer = await Transfer.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!transfer) return res.status(404).json({ error: 'Transfer not found' });

    // Sync status to Google Sheets
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
  const allowedSources = new Set([
    'telegram',
    'whatsapp',
    'manual',
    'api',
    'n8n',
  ]);

  return allowedSources.has(value)
    ? value
    : 'api';
};
