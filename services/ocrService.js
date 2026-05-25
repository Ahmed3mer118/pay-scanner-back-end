const Tesseract = require('tesseract.js');

/**
 * Run OCR on an image file path
 * Returns { text, confidence }
 */
const extractText = async (imagePath) => {
  try {
    const result = await Tesseract.recognize(imagePath, 'ara+eng', {
      logger: () => {},
    });

    const text = result.data.text || '';
    const confidence = result.data.confidence || 0;

    return { text: text.trim(), confidence: Math.round(confidence) };
  } catch (error) {
    console.error('OCR error:', error.message);
    return { text: '', confidence: 0, error: error.message };
  }
};

/**
 * Detect payment provider from raw OCR text
 */
const detectPaymentProvider = (text) => {
  const lower = text.toLowerCase();

  const providers = [
    { name: 'InstaPay', keywords: ['instapay', 'insta pay', 'انستاباي', 'انستا باي'] },
    { name: 'Vodafone Cash', keywords: ['vodafone cash', 'vodafone', 'فودافون كاش', 'فودافون'] },
    { name: 'Etisalat Cash', keywords: ['etisalat', 'اتصالات', 'e-cash', 'etisalat cash'] },
    { name: 'Orange Cash', keywords: ['orange cash', 'orange money', 'اورانج كاش', 'اورانج'] },
    { name: 'Bank Transfer', keywords: ['bank transfer', 'wire transfer', 'تحويل بنكي', 'حوالة', 'cib', 'nbe', 'banque misr', 'ahly bank'] },
  ];

  for (const provider of providers) {
    if (provider.keywords.some((kw) => lower.includes(kw))) {
      return provider.name;
    }
  }

  return 'Unknown';
};

module.exports = { extractText, detectPaymentProvider };
