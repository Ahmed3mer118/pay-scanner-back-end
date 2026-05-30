/**
 * Normalize telegram metadata from n8n / bot payloads into MongoDB fields.
 */
const normalizeTelegramMeta = (meta = {}) => {
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta);
    } catch {
      meta = {};
    }
  }

  return {
    telegramMessageId: meta.telegramMessageId ?? meta.messageId ?? null,
    telegramChatId: meta.telegramChatId != null
      ? String(meta.telegramChatId)
      : meta.chatId != null
        ? String(meta.chatId)
        : undefined,
    telegramUsername: meta.telegramUsername ?? meta.username ?? undefined,
  };
};

module.exports = { normalizeTelegramMeta };
