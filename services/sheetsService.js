const { google } = require('googleapis');

let sheetsClient = null;

const getClient = () => {
  if (sheetsClient) return sheetsClient;

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
};

const HEADERS = [
  'Date', 'Time', 'Payment Method', 'Sender Name', 'Sender Phone',
  'Receiver Name', 'Receiver Phone', 'Amount (EGP)', 'Transaction ID',
  'Status', 'OCR Confidence', 'Source', 'Image Hash', 'Created At',
];

/**
 * Ensure sheet has headers
 */
const ensureHeaders = async () => {
  if (!process.env.GOOGLE_SHEETS_ID) return;
  try {
    const sheets = getClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: 'Sheet1!A1:N1',
    });
    if (!res.data.values || res.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.GOOGLE_SHEETS_ID,
        range: 'Sheet1!A1',
        valueInputOption: 'RAW',
        requestBody: { values: [HEADERS] },
      });
    }
  } catch (e) {
    console.warn('Sheets header check failed:', e.message);
  }
};

/**
 * Append a transfer row to Google Sheets
 */
const appendTransfer = async (transfer) => {
  if (!process.env.GOOGLE_SHEETS_ID) {
    console.log('Google Sheets not configured, skipping sync.');
    return null;
  }

  try {
    const sheets = getClient();
    const date = transfer.transferDate ? new Date(transfer.transferDate) : new Date();

    const row = [
      date.toLocaleDateString('en-EG'),
      date.toLocaleTimeString('en-EG'),
      transfer.paymentMethod || '',
      transfer.senderName || '',
      transfer.senderPhone || '',
      transfer.receiverName || '',
      transfer.receiverPhone || '',
      transfer.amount || 0,
      transfer.transactionId || '',
      transfer.status || 'pending',
      transfer.ocrConfidence || 0,
      transfer.source || 'telegram',
      transfer.imageHash || '',
      new Date().toISOString(),
    ];

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: 'Sheet1!A:N',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    const updatedRange = response.data.updates?.updatedRange || '';
    const rowMatch = updatedRange.match(/(\d+)$/);
    return rowMatch ? parseInt(rowMatch[1]) : null;
  } catch (error) {
    console.error('Google Sheets append error:', error.message);
    return null;
  }
};

/**
 * Update a row status in Google Sheets
 */
const updateStatus = async (rowIndex, status) => {
  if (!process.env.GOOGLE_SHEETS_ID || !rowIndex) return;
  try {
    const sheets = getClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: `Sheet1!J${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[status]] },
    });
  } catch (e) {
    console.warn('Sheets status update failed:', e.message);
  }
};

module.exports = { appendTransfer, updateStatus, ensureHeaders };
