process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Telegraf } = require('telegraf');
const fetch = require('node-fetch');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;

// Welcome message
bot.start((ctx) => {
  ctx.reply(
    `👋 Welcome to *PayScanner Bot*!\n\n` +
    `Send me a payment screenshot and I'll extract and save all transfer details automatically.\n\n` +
    `Supported: InstaPay, Vodafone Cash, Etisalat Cash, Orange Cash, Bank Transfer`,
    { parse_mode: 'Markdown' }
  );
});

bot.help((ctx) => {
  ctx.reply(
    `📖 *PayScanner Help*\n\n` +
    `• Send any payment screenshot\n` +
    `• Bot will auto-detect the payment provider\n` +
    `• Data is extracted, validated and saved\n` +
    `• Admin dashboard updates in real-time\n\n` +
    `Commands:\n` +
    `/start - Welcome message\n` +
    `/status - Bot status\n` +
    `/help - This message`,
    { parse_mode: 'Markdown' }
  );
});
  
bot.command('status', async (ctx) => {
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`);
    const data = await res.json();
    ctx.reply(`✅ System online — ${data.timestamp}`);
  } catch {
    ctx.reply('❌ System unreachable');
  }
});

const processTelegramImage = async ({
  ctx,
  fileId,
  filename,
  mimeType = 'image/jpeg',
}) => {
  const processingMsg = await ctx.reply('⏳ Processing your screenshot...');

  try {
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const imageRes = await fetch(fileLink.href);
    const arrayBuffer = await imageRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');

    const telegramMeta = {
      telegramMessageId: ctx.message.message_id,
      telegramChatId: String(ctx.chat.id),
      telegramUsername: ctx.from.username || ctx.from.first_name,
    };

    const response = await fetch(`${BACKEND_URL}/api/bot/screenshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bot-secret': process.env.JWT_SECRET,
      },
      body: JSON.stringify({
        base64,
        filename,
        mimeType,
        source: 'telegram',
        telegramMeta,
      }),
    });

    const rawResult = await response.text();
    const result = rawResult ? JSON.parse(rawResult) : {};

    if (!response.ok && !result.status && !result.success) {
      throw new Error(result.error || `Backend request failed with status ${response.status}`);
    }

    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id).catch(() => {});

    if (result.status === 'duplicate') {
      await ctx.reply(
        `🔁 *Duplicate Screenshot Detected*\n\nSaved as duplicate for review.\nOriginal transfer: \`${result.duplicateOf || 'N/A'}\`\nNew record: \`${result.transferId || 'N/A'}\``,
        { parse_mode: 'Markdown' }
      );
    } else if (result.status === 'failed_ocr') {
      await ctx.reply(
        `❌ *OCR Failed*\n\nCould not extract text from this screenshot. Please send a clearer image.\n\nTip: Make sure the screenshot is not blurry or cropped.`,
        { parse_mode: 'Markdown' }
      );
    } else if (result.status === 'suspicious') {
      await ctx.reply(
        `⚠️ *Screenshot Flagged*\n\nThis transfer was saved but flagged for admin review.\nOur team will verify it shortly.`,
        { parse_mode: 'Markdown' }
      );

      if (ADMIN_CHAT_ID) {
        await ctx.telegram.sendMessage(
          ADMIN_CHAT_ID,
          `🚨 *Suspicious Transfer Alert*\nFrom: @${telegramMeta.telegramUsername}\nChat: ${ctx.chat.id}\nTransfer ID: ${result.transferId}`,
          { parse_mode: 'Markdown' }
        );
      }
    } else if (result.success) {
      const t = result.transfer;
      const amountStr = t.amount ? `EGP ${t.amount.toLocaleString()}` : 'N/A';

      await ctx.reply(
        `✅ *Transfer Saved Successfully!*\n\n` +
        `💰 Amount: *${amountStr}*\n` +
        `👤 Sender: ${t.senderName || 'Unknown'}\n` +
        `📱 Phone: ${t.senderPhone || 'Unknown'}\n` +
        `🏦 Method: ${t.paymentMethod}\n` +
        `🔖 Transaction ID: ${t.transactionId || 'N/A'}\n` +
        `📊 Status: ${t.status}\n\n` +
        `_OCR Confidence: ${t.ocrConfidence}%_`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply('❌ Processing failed. Please try again or contact admin.');
    }
  } catch (error) {
    console.error('Bot image handler error:', error);
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id).catch(() => {});
    await ctx.reply('❌ An error occurred. Please try again later.');
  }
};

// Handle photo messages
bot.on('photo', async (ctx) => {
  const photos = ctx.message.photo;
  const photo = photos[photos.length - 1];

  await processTelegramImage({
    ctx,
    fileId: photo.file_id,
    filename: `${photo.file_id}.jpg`,
    mimeType: 'image/jpeg',
  });
});

// Handle document (some users send screenshots as files)
bot.on('document', async (ctx) => {
  const doc = ctx.message.document;
  if (!doc.mime_type?.startsWith('image/')) {
    return ctx.reply('Please send an image file, not a document.');
  }

  await processTelegramImage({
    ctx,
    fileId: doc.file_id,
    filename: doc.file_name || `${doc.file_id}.jpg`,
    mimeType: doc.mime_type,
  });
});

bot.on('text', (ctx) => {
  if (!ctx.message.text.startsWith('/')) {
    ctx.reply('📸 Please send a payment screenshot image. I can\'t process text messages.');
  }
});

bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply('❌ An unexpected error occurred.').catch(() => {});
});

const launch = () => {
  bot.launch({
    dropPendingUpdates: true,
  });
  console.log('🤖 Telegram bot is running');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
};

module.exports = { bot, launch };
