const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/transferController');
const { protect, adminOnly } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

router.use(protect);

router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);
router.post('/upload', upload.single('screenshot'), ctrl.upload);
router.patch('/:id/status', adminOnly, ctrl.updateStatus);
router.post('/bulk-verify', adminOnly, ctrl.bulkVerify);
router.delete('/:id', adminOnly, ctrl.deleteOne);

module.exports = router;
