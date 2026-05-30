const { protect } = require('./auth');

const getBotSecret = () =>
  process.env.BOT_WEBHOOK_SECRET || process.env.JWT_SECRET;

/**
 * Allow JWT (dashboard / web) OR x-bot-secret (n8n / Telegram automation).
 */
const protectOrBot = async (req, res, next) => {
  const secret = req.headers['x-bot-secret'];
  const expected = getBotSecret();

  if (secret && expected && secret === expected) {
    req.isBotRequest = true;
    return next();
  }

  return protect(req, res, next);
};

module.exports = { protectOrBot, getBotSecret };
