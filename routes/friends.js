const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');

// GET /api/friends
router.get('/', requireAuth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT u.id, u.username, u.display_name, u.avatar, u.status, u.badge_blue, u.badge_gold, u.badge_rail
       FROM friends f JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = $1 AND u.is_banned = FALSE ORDER BY u.username`,
      [req.session.userId]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch friends' });
  }
});

// GET /api/friends/requests
router.get('/requests', requireAuth, async (req, res) => {
  try {
    const incoming = await db.query(
      `SELECT fr.id, fr.sender_id, fr.created_at, u.username, u.display_name, u.avatar
       FROM friend_requests fr JOIN users u ON u.id = fr.sender_id
       WHERE fr.receiver_id = $1 AND fr.status = 'pending' AND u.is_banned = FALSE`,
      [req.session.userId]
    );
    const outgoing = await db.query(
      `SELECT fr.id, fr.receiver_id, fr.created_at, u.username, u.display_name, u.avatar
       FROM friend_requests fr JOIN users u ON u.id = fr.receiver_id
       WHERE fr.sender_id = $1 AND fr.status = 'pending'`,
      [req.session.userId]
    );
    res.json({ incoming: incoming.rows, outgoing: outgoing.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// POST /api/friends/request
router.post('/request', requireAuth, async (req, res) => {
  const { userId } = req.body;
  if (!userId || userId === req.session.userId) return res.status(400).json({ error: 'Invalid user' });
  try {
    const target = await db.query(`SELECT id FROM users WHERE id = $1 AND is_banned = FALSE`, [userId]);
    if (!target.rows.length) return res.status(404).json({ error: 'User not found' });
    const already = await db.query(`SELECT id FROM friends WHERE user_id = $1 AND friend_id = $2`, [req.session.userId, userId]);
    if (already.rows.length) return res.status(409).json({ error: 'Already friends' });
    const existing = await db.query(
      `SELECT id FROM friend_requests WHERE ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)) AND status = 'pending'`,
      [req.session.userId, userId]
    );
    if (existing.rows.length) return res.status(409).json({ error: 'Request already pending' });
    // If they already sent us a request, accept it
    const theirRequest = await db.query(
      `SELECT id FROM friend_requests WHERE sender_id = $1 AND receiver_id = $2 AND status = 'pending'`,
      [userId, req.session.userId]
    );
    if (theirRequest.rows.length) {
      await acceptRequest(theirRequest.rows[0].id, req.session.userId, userId);
      return res.json({ message: 'Friend request accepted (they already sent one)' });
    }
    await db.query(
      `INSERT INTO friend_requests (sender_id, receiver_id) VALUES ($1, $2)`,
      [req.session.userId, userId]
    );
    // Notify via socket
    req.app.get('io').to(`user:${userId}`).emit('friend:request', { from: req.session.userId, fromUsername: req.session.username });
    res.status(201).json({ message: 'Friend request sent' });
  } catch (err) {
    console.error('Friend request error:', err);
    res.status(500).json({ error: 'Failed to send friend request' });
  }
});

async function acceptRequest(requestId, myId, theirId) {
  const client = await require('../config/database').getClient();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE friend_requests SET status = 'accepted' WHERE id = $1`, [requestId]);
    await client.query(`INSERT INTO friends (user_id, friend_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING`, [myId, theirId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// POST /api/friends/requests/:id/accept
router.post('/requests/:id/accept', requireAuth, async (req, res) => {
  try {
    const r = await db.query(`SELECT * FROM friend_requests WHERE id = $1 AND receiver_id = $2 AND status = 'pending'`, [req.params.id, req.session.userId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Request not found' });
    const { sender_id } = r.rows[0];
    await acceptRequest(parseInt(req.params.id), req.session.userId, sender_id);
    req.app.get('io').to(`user:${sender_id}`).emit('friend:accepted', { by: req.session.userId, byUsername: req.session.username });
    res.json({ message: 'Friend request accepted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to accept request' });
  }
});

// POST /api/friends/requests/:id/decline
router.post('/requests/:id/decline', requireAuth, async (req, res) => {
  try {
    await db.query(`UPDATE friend_requests SET status = 'declined' WHERE id = $1 AND receiver_id = $2`, [req.params.id, req.session.userId]);
    res.json({ message: 'Request declined' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to decline request' });
  }
});

// DELETE /api/friends/:userId
router.delete('/:userId', requireAuth, async (req, res) => {
  const friendId = parseInt(req.params.userId);
  try {
    await db.query(`DELETE FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`, [req.session.userId, friendId]);
    await db.query(`UPDATE friend_requests SET status = 'declined' WHERE ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))`, [req.session.userId, friendId]);
    res.json({ message: 'Removed friend' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove friend' });
  }
});

module.exports = router;
