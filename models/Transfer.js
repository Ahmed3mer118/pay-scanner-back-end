const mongoose = require('mongoose');

const transferSchema = new mongoose.Schema({
  transactionId: { type: String, index: false },
  senderName: { type: String, trim: true },
  senderPhone: { type: String, trim: true },
  receiverName: { type: String, trim: true },
  receiverPhone: { type: String, trim: true },
  amount: { type: Number },
  currency: { type: String, default: 'EGP' },
  paymentMethod: {
    type: String,
    enum: ['InstaPay', 'Vodafone Cash', 'Etisalat Cash', 'Orange Cash', 'Bank Transfer', 'Unknown'],
    default: 'Unknown',
  },
  transferDate: { type: Date },
  status: {
    type: String,
    enum: ['processing', 'pending', 'verified', 'duplicate', 'suspicious', 'failed_ocr'],
    default: 'pending',
  },

  // Image data
  imageUrl: { type: String },
  imageHash: { type: String, index: false },

  // OCR & AI
  ocrRawText: { type: String },
  ocrConfidence: { type: Number },
  aiParsed: { type: Boolean, default: false },
  aiValidation: {
    duplicateHash: { type: Boolean },
    duplicateTransactionId: { type: Boolean },
    amountValid: { type: Boolean },
    phoneValid: { type: Boolean },
    tamperingDetected: { type: Boolean },
    overallScore: { type: Number },
  },

  // Source
  source: { type: String, enum: ['telegram', 'whatsapp', 'manual', 'api', 'n8n'], default: 'telegram' },
  telegramMessageId: { type: Number },
  telegramChatId: { type: String },
  telegramUsername: { type: String },

  // Google Sheets sync
  sheetsSynced: { type: Boolean, default: false },
  sheetsRowIndex: { type: Number },

  // Admin actions
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  verifiedAt: { type: Date },
  adminNotes: { type: String },

  // Duplicate reference
  duplicateOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Transfer' },
}, { timestamps: true });

transferSchema.index({ imageHash: 1 });
transferSchema.index({ transactionId: 1 });
transferSchema.index({ status: 1 });
transferSchema.index({ paymentMethod: 1 });
transferSchema.index({ createdAt: -1 });
transferSchema.index({ senderPhone: 1 });
module.exports = mongoose.model('Transfer', transferSchema);
