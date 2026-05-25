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

  try {
    /**
     * 1. Convert incoming data to buffer
     */
    const {
      buffer: imageBuffer,
    } = resolveImageInput({
      buffer,
      base64,
      mimeType,
    });

    log.push('Image buffer loaded');

    /**
     * 2. Compute image hash
     */
    const imageHash = computeImageHash(imageBuffer);

    log.push(`Hash computed: ${imageHash.slice(0, 8)}...`);

    /**
     * 3. Duplicate check by image hash
     */
    const existingByHash = await Transfer.findOne({ imageHash });

    if (existingByHash) {
      await saveLog(
        'warn',
        'Duplicate image hash detected',
        {
          imageHash,
          existingId: existingByHash._id,
        }
      );

      return {
        success: false,
        status: 'duplicate',
        message: 'This screenshot has already been submitted.',
        duplicateOf: existingByHash._id,
      };
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
        status: 'failed_ocr',
        source,
        ...telegramMeta,
      });

      uploadedImage = null;

      return {
        success: false,
        status: 'failed_ocr',
        transferId: transfer._id,
        message: 'OCR failed or returned low confidence text.',
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
     * 10. Duplicate check by transaction ID
     */
    if (parsed.transactionId) {
      const existingByTxId =
        await Transfer.findOne({
          transactionId: parsed.transactionId,
        });

      if (existingByTxId) {
        await deleteUploadedImage(uploadedImage);
        uploadedImage = null;

        return {
          success: false,
          status: 'duplicate',
          message:
            `Transaction ID ${parsed.transactionId} already exists.`,
          duplicateOf: existingByTxId._id,
        };
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

    if (aiValidation.tamperingDetected) {
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
      source,
      ...telegramMeta,
    });

    uploadedImage = null;

    /**
     * 14. Sync Google Sheets
     */
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

    log.push('Transfer saved');

    /**
     * 15. Success response
     */
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