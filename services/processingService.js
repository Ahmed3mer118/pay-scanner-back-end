const fetch = require('node-fetch');
const {
  enhanceImage,
  computeImageHash,
  resolveImageInput,
} = require('./imageService');

const { extractText, detectPaymentProvider } = require('./ocrService');
const { parseWithAI, validateParsedData, sanitizeParsedData } = require('./aiService');
const { appendTransfer } = require('./sheetsService');
const {
  uploadBufferToCloudinary,
  deleteCloudinaryAsset,
} = require('../utils/uploadToCloudinary');
const { normalizeTelegramMeta } = require('../utils/telegramMeta');

const Transfer = require('../models/Transfer');
const { Log } = require('../models/Log');

const buildStoredImageHash = (imageHash, duplicateOf) => {
  if (!duplicateOf) return imageHash;
  return `${imageHash}:dup:${Date.now()}`;
};

const findExistingByHash = (imageHash) =>
  Transfer.findOne({
    $or: [
      { imageHash },
      { imageHash: new RegExp(`^${imageHash}(:dup:|$)`) },
    ],
  });

const saveLog = async (level, message, context) => {
  try {
    await Log.create({ level, message, context });
  } catch (e) {}
};

const deleteUploadedImage = async (uploadedImage) => {
  if (!uploadedImage?.public_id) return;

  try {
    await deleteCloudinaryAsset(uploadedImage.public_id);
  } catch (error) {
    console.warn('Cloudinary cleanup failed:', error.message);
  }
};

const resolveBuffer = ({ buffer, base64, mimeType }) => {
  if (Buffer.isBuffer(buffer)) {
    return buffer;
  }
  return resolveImageInput({ buffer, base64, mimeType }).buffer;
};

/**
 * Phase 1 — fast (~5–15s): enhance, upload, save with status "processing"
 */
const storeScreenshot = async ({
  buffer,
  base64,
  mimeType,
  filename,
  source = 'telegram',
  telegramMeta = {},
}) => {
  const imageBuffer = resolveBuffer({ buffer, base64, mimeType });
  const imageHash = computeImageHash(imageBuffer);
  const existingByHash = await findExistingByHash(imageHash);
  const duplicateOf = existingByHash?._id || null;
  const meta = normalizeTelegramMeta(telegramMeta);

  const enhancedBuffer = await enhanceImage(imageBuffer);
  const uploadedImage = await uploadBufferToCloudinary({
    buffer: enhancedBuffer,
    filename: filename || `${imageHash}.png`,
  });

  const transfer = await Transfer.create({
    imageUrl: uploadedImage.secure_url,
    imageHash: buildStoredImageHash(imageHash, duplicateOf),
    status: 'processing',
    duplicateOf,
    source,
    paymentMethod: 'Unknown',
    ...meta,
  });

  return {
    success: true,
    phase: 'stored',
    needsAnalysis: true,
    status: 'processing',
    transferId: transfer._id,
    transfer,
    duplicateOf,
    imageHash,
    message: 'Screenshot saved. Analysis in progress.',
  };
};

/**
 * Phase 2 — slow: OCR + AI + update transfer
 */
const analyzeTransfer = async (transferId) => {
  const transfer = await Transfer.findById(transferId);
  if (!transfer) {
    throw new Error('Transfer not found');
  }

  if (!transfer.imageUrl) {
    throw new Error('Transfer has no image to analyze');
  }

  if (transfer.status !== 'processing') {
    return {
      success: true,
      phase: 'analyze',
      status: transfer.status,
      transferId: transfer._id,
      transfer,
      message: 'Transfer already analyzed.',
    };
  }

  const response = await fetch(transfer.imageUrl);
  if (!response.ok) {
    throw new Error('Failed to download image for analysis');
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  const rawHash = computeImageHash(imageBuffer);
  let duplicateOf = transfer.duplicateOf || null;

  if (!duplicateOf) {
    const existingByHash = await findExistingByHash(rawHash);
    if (existingByHash && String(existingByHash._id) !== String(transfer._id)) {
      duplicateOf = existingByHash._id;
    }
  }

  const enhancedBuffer = await enhanceImage(imageBuffer);
  const { text: ocrText, confidence: ocrConfidence } = await extractText(enhancedBuffer);

  if (!ocrText || ocrConfidence < 20) {
    const updated = await Transfer.findByIdAndUpdate(
      transferId,
      {
        ocrRawText: ocrText,
        ocrConfidence,
        status: duplicateOf ? 'duplicate' : 'failed_ocr',
        duplicateOf,
      },
      { new: true }
    );

    return {
      success: !duplicateOf,
      phase: 'analyze',
      status: updated.status,
      transferId: updated._id,
      transfer: updated,
      duplicateOf,
      message: duplicateOf
        ? 'Duplicate screenshot saved for review.'
        : 'OCR failed or returned low confidence text.',
    };
  }

  const detectedProvider = detectPaymentProvider(ocrText);
  const parsed = sanitizeParsedData(await parseWithAI(ocrText), detectedProvider);

  if (parsed.transactionId) {
    const existingByTxId = await Transfer.findOne({
      transactionId: parsed.transactionId,
      _id: { $ne: transfer._id },
    });
    if (existingByTxId) {
      duplicateOf = duplicateOf || existingByTxId._id;
    }
  }

  const allHashes = await Transfer.distinct('imageHash');
  const aiValidation = validateParsedData(parsed, rawHash, allHashes);

  let status = 'pending';
  if (duplicateOf) {
    status = 'duplicate';
  } else if (aiValidation.tamperingDetected) {
    status = 'suspicious';
  }

  const updated = await Transfer.findByIdAndUpdate(
    transferId,
    {
      transactionId: parsed.transactionId,
      senderName: parsed.senderName,
      senderPhone: parsed.senderPhone,
      receiverName: parsed.receiverName,
      receiverPhone: parsed.receiverPhone,
      amount: parsed.amount,
      currency: parsed.currency || 'EGP',
      paymentMethod: parsed.paymentMethod,
      transferDate: parsed.transferDate ? new Date(parsed.transferDate) : new Date(),
      status,
      ocrRawText: ocrText,
      ocrConfidence,
      aiParsed: true,
      aiValidation,
      duplicateOf,
    },
    { new: true }
  );

  if (status !== 'duplicate') {
    try {
      const rowIndex = await appendTransfer(updated);
      if (rowIndex) {
        await Transfer.findByIdAndUpdate(transferId, {
          sheetsSynced: true,
          sheetsRowIndex: rowIndex,
        });
      }
    } catch (sheetErr) {
      console.warn('Sheets sync failed:', sheetErr.message);
    }
  }

  if (status === 'duplicate') {
    return {
      success: true,
      phase: 'analyze',
      status: 'duplicate',
      transferId: updated._id,
      transfer: updated,
      duplicateOf,
      aiValidation,
      message: 'Duplicate screenshot saved. This image was already submitted.',
    };
  }

  return {
    success: true,
    phase: 'analyze',
    status,
    transferId: updated._id,
    transfer: updated,
    aiValidation,
    message:
      status === 'suspicious'
        ? 'Transfer saved but flagged as suspicious.'
        : 'Transfer processed and saved successfully.',
  };
};

/**
 * Full pipeline in one call (local / full=1 only — may timeout on Vercel).
 */
const processScreenshot = async (input) => {
  const stored = await storeScreenshot(input);
  if (!stored.transferId) {
    return stored;
  }

  try {
    return await analyzeTransfer(stored.transferId);
  } catch (error) {
    console.error('Analyze after store failed:', error.message);
    return {
      ...stored,
      success: false,
      needsAnalysis: true,
      message: `Image saved but analysis failed: ${error.message}`,
    };
  }
};

module.exports = {
  storeScreenshot,
  analyzeTransfer,
  processScreenshot,
};
