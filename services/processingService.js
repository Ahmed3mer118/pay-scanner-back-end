const {
  enhanceImage,
  computeImageHash,
  resolveImageInput,
} = require('./imageService');

const { extractText, detectPaymentProvider } = require('./ocrService');
const { parseWithAI, validateParsedData } = require('./aiService');
const { appendTransfer } = require('./sheetsService');
const {
  uploadBufferToCloudinary,
  deleteCloudinaryAsset,
} = require('../utils/uploadToCloudinary');

const Transfer = require('../models/Transfer');
const { Log } = require('../models/Log');

/**
 * Full pipeline:
 * buffer/base64 → enhance buffer → Cloudinary upload → OCR → AI parse → Mongo save
 *
 * Vercel compatible
 * No filesystem used
 */
const processScreenshot = async ({
  buffer,
  base64,
  mimeType,
  filename,
  source = 'telegram',
  telegramMeta = {},
}) => {
  const log = [];
  let uploadedImage = null;
  let duplicateOf = null;

  try {
    /**
     * 1. Convert incoming data to buffer
     */
    let imageBuffer;
    if (Buffer.isBuffer(buffer)) {
      imageBuffer = buffer;
    } else {
      ({ buffer: imageBuffer } = resolveImageInput({ buffer, base64, mimeType }));
    }

    log.push('Image buffer loaded');

    /**
     * 2. Compute image hash
     */
    const imageHash = computeImageHash(imageBuffer);

    log.push(`Hash computed: ${imageHash.slice(0, 8)}...`);

    /**
     * 3. Duplicate check by image hash (still process and save)
     */
    const existingByHash = await Transfer.findOne({ imageHash });

    if (existingByHash) {
      duplicateOf = existingByHash._id;
      await saveLog(
        'warn',
        'Duplicate image hash detected',
        {
          imageHash,
          existingId: existingByHash._id,
        }
      );
      log.push('Duplicate image hash — will save as duplicate');
    }

    /**
     * 4. Enhance image
     */
    const enhancedBuffer = await enhanceImage(imageBuffer);

    log.push('Image enhanced');

    /**
     * 5. Upload enhanced image to Cloudinary
     */
    uploadedImage = await uploadBufferToCloudinary({
      buffer: enhancedBuffer,
      filename: filename || `${imageHash}.png`,
    });

    log.push('Image uploaded to Cloudinary');

    /**
     * 6. OCR
     */
    const {
      text: ocrText,
      confidence: ocrConfidence,
    } = await extractText(enhancedBuffer);

    log.push(`OCR done, confidence: ${ocrConfidence}%`);

    /**
     * 7. OCR validation
     */
    if (!ocrText || ocrConfidence < 20) {
      const transfer = await Transfer.create({
        imageUrl: uploadedImage.secure_url,
        imageHash,
        ocrRawText: ocrText,
        ocrConfidence,
        status: duplicateOf ? 'duplicate' : 'failed_ocr',
        duplicateOf,
        source,
        ...telegramMeta,
      });

      uploadedImage = null;

      return {
        success: !duplicateOf,
        status: transfer.status,
        transferId: transfer._id,
        transfer,
        duplicateOf,
        message: duplicateOf
          ? 'Duplicate screenshot saved for review.'
          : 'OCR failed or returned low confidence text.',
      };
    }

    /**
     * 8. Detect provider
     */
    const detectedProvider =
      detectPaymentProvider(ocrText);

    log.push(`Provider detected: ${detectedProvider}`);

    /**
     * 9. AI parsing
     */
    const parsed = await parseWithAI(ocrText);

    if (
      parsed.paymentMethod === 'Unknown' &&
      detectedProvider !== 'Unknown'
    ) {
      parsed.paymentMethod = detectedProvider;
    }

    log.push('AI parsing complete');

    /**
     * 10. Duplicate check by transaction ID (still save)
     */
    if (parsed.transactionId) {
      const existingByTxId =
        await Transfer.findOne({
          transactionId: parsed.transactionId,
        });

      if (existingByTxId) {
        duplicateOf = duplicateOf || existingByTxId._id;
        log.push(`Duplicate transaction ID: ${parsed.transactionId}`);
      }
    }

    /**
     * 11. AI validation
     */
    const allHashes =
      await Transfer.distinct('imageHash');

    const aiValidation = validateParsedData(
      parsed,
      imageHash,
      allHashes
    );

    log.push(
      `Validation score: ${aiValidation.overallScore}%`
    );

    /**
     * 12. Determine status
     */
    let status = 'pending';

    if (duplicateOf) {
      status = 'duplicate';
    } else if (aiValidation.tamperingDetected) {
      status = 'suspicious';
    } else if (aiValidation.overallScore >= 70) {
      status = 'pending';
    }

    /**
     * 13. Save transfer
     */
    const transfer = await Transfer.create({
      transactionId: parsed.transactionId,
      senderName: parsed.senderName,
      senderPhone: parsed.senderPhone,
      receiverName: parsed.receiverName,
      receiverPhone: parsed.receiverPhone,
      amount: parsed.amount,
      currency:
        parsed.currency || 'EGP',
      paymentMethod:
        parsed.paymentMethod,
      transferDate:
        parsed.transferDate
          ? new Date(parsed.transferDate)
          : new Date(),
      status,
      imageUrl: uploadedImage.secure_url,
      imageHash,
      ocrRawText: ocrText,
      ocrConfidence,
      aiParsed: true,
      aiValidation,
      duplicateOf,
      source,
      ...telegramMeta,
    });

    uploadedImage = null;

    /**
     * 14. Sync Google Sheets (skip duplicates)
     */
    if (status !== 'duplicate') {
      try {
        const rowIndex =
          await appendTransfer(transfer);

        if (rowIndex) {

          await Transfer.findByIdAndUpdate(
            transfer._id,
            {
              sheetsSynced: true,
              sheetsRowIndex: rowIndex,
            }
          );
        }

      } catch (sheetErr) {

        console.warn(
          'Sheets sync failed:',
          sheetErr.message
        );
      }
    }

    log.push('Transfer saved');

    /**
     * 15. Response
     */
    if (status === 'duplicate') {
      return {
        success: true,
        status: 'duplicate',
        transferId: transfer._id,
        transfer,
        duplicateOf,
        aiValidation,
        message: 'Duplicate screenshot saved. This image was already submitted.',
      };
    }

    return {
      success: true,
      status,
      transferId: transfer._id,
      transfer,
      aiValidation,
      message:
        status === 'suspicious'
          ? '⚠️ Transfer saved but flagged as suspicious.'
          : '✅ Transfer processed and saved successfully.',
    };
  } catch (error) {
    console.error('Pipeline error:', error);

    await deleteUploadedImage(uploadedImage);

    await saveLog(
      'error',
      'Pipeline failed',
      {
        error: error.message,
        source,
        filename,
      }
    );

    throw error;
  }
};

/**
 * Save logs
 */
const saveLog = async (
  level,
  message,
  context
) => {

  try {

    await Log.create({
      level,
      message,
      context,
    });

  } catch (e) {}
};

const deleteUploadedImage = async (uploadedImage) => {
  if (!uploadedImage?.public_id) {
    return;
  }

  try {
    await deleteCloudinaryAsset(uploadedImage.public_id);
  } catch (error) {
    console.warn('Cloudinary cleanup failed:', error.message);
  }
};

module.exports = {
  processScreenshot,
};
