const path = require('path');
const { enhanceImage, computeImageHash, saveBuffer, cleanupFile } = require('./imageService');
const { extractText, detectPaymentProvider } = require('./ocrService');
const { parseWithAI, validateParsedData } = require('./aiService');
const { appendTransfer } = require('./sheetsService');
const Transfer = require('../models/Transfer');
const { Log } = require('../models/Log');

/**
 * Full pipeline: buffer → enhance → OCR → AI parse → validate → save
 */
const processScreenshot = async ({ buffer, filename, source = 'telegram', telegramMeta = {} }) => {
  let rawPath = null;
  let enhancedPath = null;
  const log = [];

  try {
    // 1. Save raw buffer
    const saved = await saveBuffer(buffer, filename);
    rawPath = saved.filePath;
    log.push('Image saved');

    // 2. Compute hash for duplicate detection
    const imageHash = computeImageHash(buffer);
    log.push(`Hash computed: ${imageHash.slice(0, 8)}...`);

    // 3. Check duplicate by hash
    const existingByHash = await Transfer.findOne({ imageHash });
    if (existingByHash) {
      cleanupFile(rawPath);
      await saveLog('warn', 'Duplicate image hash detected', { imageHash, existingId: existingByHash._id });
      return {
        success: false,
        status: 'duplicate',
        message: 'This screenshot has already been submitted.',
        duplicateOf: existingByHash._id,
      };
    }

    // 4. Enhance image for OCR
    const enhanced = await enhanceImage(rawPath);
    enhancedPath = enhanced.outputPath;
    log.push('Image enhanced');

    // 5. OCR
    const { text: ocrText, confidence: ocrConfidence } = await extractText(enhancedPath);
    log.push(`OCR done, confidence: ${ocrConfidence}%`);

    if (!ocrText || ocrConfidence < 20) {
      const transfer = await Transfer.create({
        imageHash,
        imagePath: saved.filename,
        imageUrl: `/uploads/${saved.filename}`,
        ocrRawText: ocrText,
        ocrConfidence,
        status: 'failed_ocr',
        source,
        ...telegramMeta,
      });
      cleanupFile(enhancedPath);
      return { success: false, status: 'failed_ocr', transferId: transfer._id, message: 'OCR failed or returned low confidence text.' };
    }

    // 6. Detect provider from OCR text
    const detectedProvider = detectPaymentProvider(ocrText);
    log.push(`Provider detected: ${detectedProvider}`);

    // 7. AI parsing
    const parsed = await parseWithAI(ocrText, enhancedPath);
    if (parsed.paymentMethod === 'Unknown' && detectedProvider !== 'Unknown') {
      parsed.paymentMethod = detectedProvider;
    }
    log.push('AI parsing complete');

    // 8. Check duplicate by transaction ID
    if (parsed.transactionId) {
      const existingByTxId = await Transfer.findOne({ transactionId: parsed.transactionId });
      if (existingByTxId) {
        cleanupFile(rawPath);
        cleanupFile(enhancedPath);
        return {
          success: false,
          status: 'duplicate',
          message: `Transaction ID ${parsed.transactionId} already exists.`,
          duplicateOf: existingByTxId._id,
        };
      }
    }

    // 9. AI validation
    const allHashes = await Transfer.distinct('imageHash');
    const aiValidation = validateParsedData(parsed, imageHash, allHashes);
    log.push(`Validation score: ${aiValidation.overallScore}%`);

    // 10. Determine status
    let status = 'pending';
    if (aiValidation.tamperingDetected) status = 'suspicious';
    else if (aiValidation.overallScore >= 70) status = 'pending';

    // 11. Save to MongoDB
    const transfer = await Transfer.create({
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
      imageHash,
      imagePath: saved.filename,
      imageUrl: `/uploads/${saved.filename}`,
      ocrRawText: ocrText,
      ocrConfidence,
      aiParsed: true,
      aiValidation,
      source,
      ...telegramMeta,
    });

    // 12. Sync to Google Sheets
    try {
      const rowIndex = await appendTransfer(transfer);
      if (rowIndex) {
        await Transfer.findByIdAndUpdate(transfer._id, { sheetsSynced: true, sheetsRowIndex: rowIndex });
      }
    } catch (sheetErr) {
      console.warn('Sheets sync failed:', sheetErr.message);
    }

    cleanupFile(enhancedPath);
    log.push('Transfer saved');

    return {
      success: true,
      status,
      transferId: transfer._id,
      transfer,
      aiValidation,
      message: status === 'suspicious'
        ? '⚠️ Transfer saved but flagged as suspicious.'
        : '✅ Transfer processed and saved successfully.',
    };
  } catch (error) {
    console.error('Pipeline error:', error);
    if (rawPath) cleanupFile(rawPath);
    if (enhancedPath) cleanupFile(enhancedPath);
    await saveLog('error', 'Pipeline failed', { error: error.message });
    throw error;
  }
};

const saveLog = async (level, message, context) => {
  try {
    await Log.create({ level, message, context });
  } catch (e) {}
};

module.exports = { processScreenshot };
