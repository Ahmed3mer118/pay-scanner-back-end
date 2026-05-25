// routes/dashboard.js
const express = require('express');
const router = express.Router();
const { getStats, getMethodBreakdown } = require('../controllers/dashboardController');
const { protect } = require('../middleware/auth');

router.use(protect);
router.get('/stats', getStats);
router.get('/methods', getMethodBreakdown);

module.exports = router;
