const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');

// GET /api/notifications
router.get('/', requireAuth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.session.userId]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// POST /api/notifications/read-all
router.post('/read-all', requireAuth, async (req, res) => {
  await db.query(`UPDATE notifications SET is_read = TRUE WHERE user_id = $1`, [req.session.userId]);
  res.json({ message: 'All notifications marked read' });
});

// DELETE /api/notifications/:id
router.delete('/:id', requireAuth, async (req, res) => {
  await db.query(`DELETE FROM notifications WHERE id = $1 AND user_id = $2`, [req.params.id, req.session.userId]);
  res.json({ message: 'Deleted' });
});

module.exports = router;
