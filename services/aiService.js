const OpenAI = require('openai');

let openai;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const SYSTEM_PROMPT = `You are an expert payment receipt parser for Egyptian payment systems.
Extract structured data from OCR text of payment screenshots.
Always respond with valid JSON only. No markdown, no explanation.

JSON schema:
{
  "senderName": "string or null",
  "senderPhone": "string or null (Egyptian format 01xxxxxxxxx)",
  "receiverName": "string or null",
  "receiverPhone": "string or null",
  "amount": number or null,
  "currency": "EGP",
  "transactionId": "string or null",
  "transferDate": "ISO 8601 string or null",
  "paymentMethod": "InstaPay|Vodafone Cash|Etisalat Cash|Orange Cash|Bank Transfer|Unknown",
  "confidence": number (0-100),
  "flags": {
    "missingFields": ["array of missing field names"],
    "suspiciousIndicators": ["array of suspicious signals"],
    "likelyEdited": boolean
  }
}`;

/**
 * Parse OCR text using OpenAI GPT-4
 */
const parseWithAI = async (ocrText) => {
  if (!openai) {
    return fallbackParse(ocrText);
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Parse this payment receipt OCR text:\n\n${ocrText}`,
        },
      ],
      max_tokens: 500,
      temperature: 0,
    });

    const content = response.choices[0].message.content.trim();
    return parseJsonResponse(content);
  } catch (error) {
    console.error('AI parse error:', error.message);
    return fallbackParse(ocrText);
  }
};

function parseJsonResponse(content) {
  try {
    return JSON.parse(content);
  } catch (error) {
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw error;
    }

    return JSON.parse(jsonMatch[0]);
  }
}

/**
 * Regex-based fallback parser when OpenAI is unavailable
 */
const fallbackParse = (text) => {
  const phoneRegex = /0[0-9]{10}/g;
  const amountRegex = /(?:EGP|جنيه|ج\.م)?\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:EGP|جنيه|ج\.م)?/gi;
  const txIdRegex = /(?:ref|reference|transaction|txn|رقم العملية)[:\s#]*([A-Z0-9\-]{6,30})/i;
  const dateRegex = /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}-\d{2}-\d{2})/;

  const phones = text.match(phoneRegex) || [];
  const amounts = [...text.matchAll(amountRegex)].map((m) => parseFloat(m[1].replace(',', '')));
  const txMatch = text.match(txIdRegex);
  const dateMatch = text.match(dateRegex);

  const amount = amounts.length > 0 ? Math.max(...amounts.filter((a) => a > 0)) : null;

  const transferDate = parseDetectedDate(dateMatch?.[1]);

  return {
    senderName: null,
    senderPhone: phones[0] || null,
    receiverName: null,
    receiverPhone: phones[1] || null,
    amount,
    currency: 'EGP',
    transactionId: txMatch ? txMatch[1] : null,
    transferDate,
    paymentMethod: 'Unknown',
    confidence: 40,
    flags: {
      missingFields: ['senderName', 'receiverName'],
      suspiciousIndicators: ['Used fallback parser - OpenAI unavailable'],
      likelyEdited: false,
    },
  };
};

function parseDetectedDate(value) {
  if (!value) {
    return null;
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate.toISOString();
}

/**
 * Validate parsed data and compute AI validation object
 */
const validateParsedData = (parsed, imageHash, existingHashes = []) => {
  const duplicateHash = existingHashes.includes(imageHash);
  const amountValid = parsed.amount !== null && parsed.amount > 0 && parsed.amount < 10000000;
  const phoneRegex = /^01[0-9]{9}$/;
  const phoneValid = parsed.senderPhone ? phoneRegex.test(parsed.senderPhone) : false;

  const overallScore = [
    !duplicateHash,
    amountValid,
    phoneValid,
    parsed.senderName !== null,
    parsed.transactionId !== null,
    !parsed.flags?.likelyEdited,
  ].filter(Boolean).length / 6 * 100;

  return {
    duplicateHash: !duplicateHash,
    duplicateTransactionId: true,
    amountValid,
    phoneValid,
    tamperingDetected: parsed.flags?.likelyEdited || false,
    overallScore: Math.round(overallScore),
  };
};

module.exports = { parseWithAI, validateParsedData, fallbackParse };
