require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const connectDB = require('./utils/db');

const authRoutes = require('./routes/auth');
const transferRoutes = require('./routes/transfers');
const dashboardRoutes = require('./routes/dashboard');
const botRoutes = require('./routes/bot');

const app = express();
const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '15mb';

// Connect to MongoDB
connectDB();

// Security middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

const botLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
});
app.use('/api/bot/', botLimiter);

// Body parsing
app.use(express.json({ limit: requestBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: requestBodyLimit }));
app.use(morgan('dev'));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/transfers', transferRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/bot', botRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 PayScanner server running on port ${PORT}`);
  if (process.env.TELEGRAM_BOT_TOKEN) {
    require('./bot').launch();
    console.log('🤖 Telegram bot launched');
  }
});

module.exports = app;
