const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  level: { type: String, enum: ['info', 'warn', 'error'], default: 'info' },
  message: { type: String, required: true },
  context: { type: mongoose.Schema.Types.Mixed },
  transferId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transfer' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const paymentMethodSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  isActive: { type: Boolean, default: true },
  keywords: [{ type: String }],
  patterns: [{ type: String }],
  totalTransactions: { type: Number, default: 0 },
  totalAmount: { type: Number, default: 0 },
}, { timestamps: true });

const Log = mongoose.model('Log', logSchema);
const PaymentMethod = mongoose.model('PaymentMethod', paymentMethodSchema);

module.exports = { Log, PaymentMethod };
