const Transfer = require('../models/Transfer');

exports.getStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);

    const [
      totalToday, totalAmount, pending, duplicates, failedOcr,
      byStatus, byMethod, last7Days, last30Days,
    ] = await Promise.all([
      Transfer.countDocuments({ createdAt: { $gte: today } }),
      Transfer.aggregate([
        { $match: { status: 'verified', createdAt: { $gte: today } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Transfer.countDocuments({ status: 'pending' }),
      Transfer.countDocuments({ status: 'duplicate', createdAt: { $gte: today } }),
      Transfer.countDocuments({ status: 'failed_ocr', createdAt: { $gte: today } }),
      Transfer.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Transfer.aggregate([
        { $match: { status: { $ne: 'duplicate' } } },
        { $group: { _id: '$paymentMethod', count: { $sum: 1 }, total: { $sum: '$amount' } } },
        { $sort: { count: -1 } },
      ]),
      Transfer.aggregate([
        {
          $match: {
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
            amount: { $sum: '$amount' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Transfer.aggregate([
        {
          $match: {
            createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            status: 'verified',
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            amount: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    res.json({
      today: {
        transfers: totalToday,
        amount: totalAmount[0]?.total || 0,
        pending,
        duplicates,
        failedOcr,
      },
      byStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
      byMethod,
      charts: { last7Days, last30Days },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getMethodBreakdown = async (req, res) => {
  try {
    const data = await Transfer.aggregate([
      { $match: { status: { $nin: ['duplicate', 'failed_ocr'] } } },
      {
        $group: {
          _id: '$paymentMethod',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          verified: { $sum: { $cond: [{ $eq: ['$status', 'verified'] }, 1, 0] } },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const grandTotal = data.reduce((sum, d) => sum + d.count, 0);
    const result = data.map((d) => ({
      ...d,
      percentage: grandTotal > 0 ? Math.round((d.count / grandTotal) * 100) : 0,
    }));

    res.json({ methods: result, grandTotal });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
