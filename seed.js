
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/payscanner';

const USERS = [
  { name: 'Store Admin', email: 'admin@store.com', password: 'admin123', role: 'admin' },
  { name: 'Viewer User', email: 'viewer@store.com', password: 'viewer123', role: 'viewer' },
];

const TRANSFERS = [
  { transactionId: 'IP-20260525-88210', senderName: 'Mohamed Ali', senderPhone: '01001234567', receiverName: 'Store Admin', receiverPhone: '01099887766', amount: 3200, paymentMethod: 'InstaPay', status: 'verified', ocrConfidence: 96, source: 'telegram', aiParsed: true, aiValidation: { duplicateHash: true, duplicateTransactionId: true, amountValid: true, phoneValid: true, tamperingDetected: false, overallScore: 97 }, sheetsSynced: false, transferDate: new Date('2026-05-25T09:14:00') },
  { transactionId: 'VF-20260525-33421', senderName: 'Sara Ibrahim', senderPhone: '01112345678', receiverName: 'Store Admin', receiverPhone: '01099887766', amount: 750, paymentMethod: 'Vodafone Cash', status: 'pending', ocrConfidence: 88, source: 'telegram', aiParsed: true, aiValidation: { duplicateHash: true, duplicateTransactionId: true, amountValid: true, phoneValid: true, tamperingDetected: false, overallScore: 82 }, sheetsSynced: false, transferDate: new Date('2026-05-25T10:30:00') },
  { transactionId: 'BT-20260525-55512', senderName: 'Ahmed Nasser', senderPhone: '01223456789', receiverName: 'Store Admin', receiverPhone: '01099887766', amount: 5000, paymentMethod: 'Bank Transfer', status: 'verified', ocrConfidence: 94, source: 'telegram', aiParsed: true, aiValidation: { duplicateHash: true, duplicateTransactionId: true, amountValid: true, phoneValid: true, tamperingDetected: false, overallScore: 95 }, sheetsSynced: false, transferDate: new Date('2026-05-25T11:00:00') },
  { transactionId: 'ET-20260525-77001', senderName: 'Noura Khaled', senderPhone: '01012345670', receiverName: 'Store Admin', receiverPhone: '01099887766', amount: 1200, paymentMethod: 'Etisalat Cash', status: 'suspicious', ocrConfidence: 72, source: 'telegram', aiParsed: true, aiValidation: { duplicateHash: true, duplicateTransactionId: true, amountValid: true, phoneValid: false, tamperingDetected: true, overallScore: 45 }, sheetsSynced: false, transferDate: new Date('2026-05-25T11:30:00') },
  { transactionId: 'IP-20260525-88210', senderName: 'Omar Farouk', senderPhone: '01512345671', receiverName: 'Store Admin', receiverPhone: '01099887766', amount: 2800, paymentMethod: 'InstaPay', status: 'duplicate', ocrConfidence: 91, source: 'telegram', aiParsed: true, aiValidation: { duplicateHash: false, duplicateTransactionId: false, amountValid: true, phoneValid: true, tamperingDetected: false, overallScore: 30 }, sheetsSynced: false, transferDate: new Date('2026-05-25T12:00:00') },
  { transactionId: 'OR-20260524-22981', senderName: 'Dina Mahmoud', senderPhone: '01001111222', receiverName: 'Store Admin', receiverPhone: '01099887766', amount: 450, paymentMethod: 'Orange Cash', status: 'verified', ocrConfidence: 89, source: 'telegram', aiParsed: true, aiValidation: { duplicateHash: true, duplicateTransactionId: true, amountValid: true, phoneValid: true, tamperingDetected: false, overallScore: 90 }, sheetsSynced: false, transferDate: new Date('2026-05-24T09:00:00') },
  { transactionId: 'BT-20260524-66743', senderName: 'Karim Taher', senderPhone: '01234567890', receiverName: 'Store Admin', receiverPhone: '01099887766', amount: 9900, paymentMethod: 'Bank Transfer', status: 'verified', ocrConfidence: 97, source: 'telegram', aiParsed: true, aiValidation: { duplicateHash: true, duplicateTransactionId: true, amountValid: true, phoneValid: true, tamperingDetected: false, overallScore: 98 }, sheetsSynced: false, transferDate: new Date('2026-05-24T10:00:00') },
  { senderName: 'Lina Hassan', senderPhone: '01098765432', receiverName: 'Store Admin', receiverPhone: '01099887766', amount: 600, paymentMethod: 'Vodafone Cash', status: 'pending', ocrConfidence: 61, source: 'telegram', aiParsed: true, aiValidation: { duplicateHash: true, duplicateTransactionId: true, amountValid: true, phoneValid: true, tamperingDetected: false, overallScore: 68 }, sheetsSynced: false, transferDate: new Date('2026-05-24T11:00:00') },
  { senderName: 'Youssef Samir', senderPhone: '01187654321', receiverName: 'Store Admin', receiverPhone: '01099887766', amount: 3500, paymentMethod: 'InstaPay', status: 'failed_ocr', ocrConfidence: 15, source: 'telegram', aiParsed: false, sheetsSynced: false, transferDate: new Date('2026-05-24T12:00:00') },
  { transactionId: 'ET-20260524-91110', senderName: 'Rania Adel', senderPhone: '01076543219', receiverName: 'Store Admin', receiverPhone: '01099887766', amount: 1800, paymentMethod: 'Etisalat Cash', status: 'verified', ocrConfidence: 93, source: 'telegram', aiParsed: true, aiValidation: { duplicateHash: true, duplicateTransactionId: true, amountValid: true, phoneValid: true, tamperingDetected: false, overallScore: 94 }, sheetsSynced: false, transferDate: new Date('2026-05-24T13:00:00') },
];

async function seed() {
  console.log('🌱 Seeding PayScanner database...');
  await mongoose.connect(MONGO_URI);

  const User = require('./models/User');
  const Transfer = require('./models/Transfer');
  const { PaymentMethod } = require('./models/Log');

  // Clear existing
  await Promise.all([User.deleteMany(), Transfer.deleteMany(), PaymentMethod.deleteMany()]);
  console.log('🗑️  Cleared existing data');

  // Seed users
  for (const u of USERS) {
    await User.create(u);
  }
  console.log(`✅ Created ${USERS.length} users`);

  // Seed transfers with unique hashes
  const { computeImageHash } = require('./services/imageService');
  for (let i = 0; i < TRANSFERS.length; i++) {
    const fakeHash = computeImageHash(Buffer.from(`fake_image_${i}_${Date.now()}`));
    await Transfer.create({ ...TRANSFERS[i], imageHash: fakeHash });
  }
  console.log(`✅ Created ${TRANSFERS.length} transfers`);

  // Seed payment methods
  const methods = [
    { name: 'InstaPay', keywords: ['instapay', 'انستاباي'], isActive: true },
    { name: 'Vodafone Cash', keywords: ['vodafone', 'فودافون'], isActive: true },
    { name: 'Etisalat Cash', keywords: ['etisalat', 'اتصالات'], isActive: true },
    { name: 'Orange Cash', keywords: ['orange', 'اورانج'], isActive: true },
    { name: 'Bank Transfer', keywords: ['bank', 'تحويل بنكي'], isActive: true },
  ];
  await PaymentMethod.insertMany(methods);
  console.log(`✅ Created ${methods.length} payment methods`);

  console.log('\n🎉 Seed complete!');
  console.log('Admin login: admin@store.com / admin123');
  await mongoose.disconnect();
}

seed().catch((e) => { console.error(e); process.exit(1); });
