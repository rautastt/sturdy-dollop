const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAdmin } = require('../middleware/auth');

// All routes require admin
router.use(requireAdmin);

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const [users, servers, messages, bans] = await Promise.all([
      db.query(`SELECT COUNT(*) FROM users WHERE is_banned=FALSE`),
      db.query(`SELECT COUNT(*) FROM servers`),
      db.query(`SELECT COUNT(*) FROM messages WHERE is_deleted=FALSE`),
      db.query(`SELECT COUNT(*) FROM bans WHERE is_active=TRUE`),
    ]);
    res.json({
      totalUsers: parseInt(users.rows[0].count),
      totalServers: parseInt(servers.rows[0].count),
      totalMessages: parseInt(messages.rows[0].count),
      activeBans: parseInt(bans.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/admin/users?q=&page=1
router.get('/users', async (req, res) => {
  const q = req.query.q || '';
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 25;
  const offset = (page - 1) * limit;
  try {
    const result = await db.query(
      `SELECT id, username, display_name, email, is_admin, is_banned, ban_reason,
              badge_blue, badge_gold, badge_rail, badge_admin,
              points, xp, level, email_verified, created_at, last_seen, status, avatar
       FROM users
       WHERE ($1='' OR LOWER(username) LIKE LOWER($1) OR LOWER(email) LIKE LOWER($1))
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [q ? `%${q}%` : '', limit, offset]
    );
    const total = await db.query(
      `SELECT COUNT(*) FROM users WHERE ($1='' OR LOWER(username) LIKE LOWER($1) OR LOWER(email) LIKE LOWER($1))`,
      [q ? `%${q}%` : '']
    );
    res.json({ users: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/admin/bans
router.get('/bans', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT b.*, u.username AS banned_by_username
       FROM bans b LEFT JOIN users u ON u.id = b.banned_by
       WHERE b.is_active = TRUE ORDER BY b.created_at DESC LIMIT 100`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bans' });
  }
});

// GET /api/admin/modlogs?page=1
router.get('/modlogs', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 50;
  const offset = (page - 1) * limit;
  try {
    const result = await db.query(
      `SELECT ml.*, a.username AS admin_username, t.username AS target_username
       FROM moderation_logs ml
       LEFT JOIN users a ON a.id = ml.admin_id
       LEFT JOIN users t ON t.id = ml.target_id
       ORDER BY ml.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const total = await db.query(`SELECT COUNT(*) FROM moderation_logs`);
    res.json({ logs: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// GET /api/admin/servers
router.get('/servers', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT s.*, u.username AS owner_username,
              (SELECT COUNT(*) FROM server_members WHERE server_id=s.id) AS member_count,
              (SELECT COUNT(*) FROM channels WHERE server_id=s.id) AS channel_count
       FROM servers s LEFT JOIN users u ON u.id=s.owner_id
       ORDER BY s.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch servers' });
  }
});

// POST /api/admin/users/:id/ban
router.post('/users/:id/ban', async (req, res) => {
  const targetId = parseInt(req.params.id);
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Reason required' });
  if (targetId === req.session.userId) return res.status(400).json({ error: 'Cannot ban yourself' });
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const target = await client.query(`SELECT username, email, is_admin FROM users WHERE id=$1`, [targetId]);
    if (!target.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }
    if (target.rows[0].is_admin) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Cannot ban an admin' }); }
    const { username, email } = target.rows[0];
    await client.query(`UPDATE users SET is_banned=TRUE, ban_reason=$1 WHERE id=$2`, [reason, targetId]);
    await client.query(`DELETE FROM session WHERE (sess->>'userId')::text=$1::text`, [String(targetId)]);
    await client.query(`DELETE FROM server_members WHERE user_id=$1`, [targetId]);
    await client.query(`DELETE FROM friends WHERE user_id=$1 OR friend_id=$1`, [targetId]);
    await client.query(`INSERT INTO bans (user_id,username,email,reason,banned_by) VALUES ($1,$2,$3,$4,$5)`, [targetId, username, email, reason, req.session.userId]);
    await client.query(`INSERT INTO moderation_logs (admin_id,target_id,action,reason) VALUES ($1,$2,'ban',$3)`, [req.session.userId, targetId, reason]);
    await client.query('COMMIT');
    res.json({ message: 'User banned' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to ban user' });
  } finally {
    client.release();
  }
});

// POST /api/admin/users/:id/unban
router.post('/users/:id/unban', async (req, res) => {
  const targetId = parseInt(req.params.id);
  try {
    await db.query(`UPDATE users SET is_banned=FALSE, ban_reason=NULL WHERE id=$1`, [targetId]);
    await db.query(`UPDATE bans SET is_active=FALSE, unbanned_at=NOW() WHERE user_id=$1 AND is_active=TRUE`, [targetId]);
    await db.query(`INSERT INTO moderation_logs (admin_id,target_id,action) VALUES ($1,$2,'unban')`, [req.session.userId, targetId]);
    res.json({ message: 'User unbanned' });
  } catch (err) { res.status(500).json({ error: 'Failed to unban' }); }
});

// POST /api/admin/users/:id/badge
router.post('/users/:id/badge', async (req, res) => {
  const { badge, grant } = req.body;
  const allowed = ['badge_blue', 'badge_gold', 'badge_rail', 'badge_admin'];
  if (!allowed.includes(badge)) return res.status(400).json({ error: 'Invalid badge' });
  const targetId = parseInt(req.params.id);
  try {
    await db.query(`UPDATE users SET ${badge}=$1 WHERE id=$2`, [!!grant, targetId]);
    await db.query(`INSERT INTO moderation_logs (admin_id,target_id,action) VALUES ($1,$2,$3)`,
      [req.session.userId, targetId, `${grant?'grant':'remove'}_${badge}`]);
    res.json({ message: `Badge ${grant ? 'granted' : 'removed'}` });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// POST /api/admin/users/:id/points
router.post('/users/:id/points', async (req, res) => {
  const { delta } = req.body;
  if (typeof delta !== 'number') return res.status(400).json({ error: 'delta must be a number' });
  const targetId = parseInt(req.params.id);
  try {
    await db.query(`UPDATE users SET points=GREATEST(0,points+$1) WHERE id=$2`, [delta, targetId]);
    await db.query(`INSERT INTO moderation_logs (admin_id,target_id,action,metadata) VALUES ($1,$2,'points',$3)`,
      [req.session.userId, targetId, JSON.stringify({ delta })]);
    res.json({ message: 'Points updated' });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// POST /api/admin/users/:id/reset-xp
router.post('/users/:id/reset-xp', async (req, res) => {
  const targetId = parseInt(req.params.id);
  try {
    await db.query(`UPDATE users SET xp=0,level=1 WHERE id=$1`, [targetId]);
    await db.query(`INSERT INTO moderation_logs (admin_id,target_id,action) VALUES ($1,$2,'reset_xp')`, [req.session.userId, targetId]);
    res.json({ message: 'XP reset' });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// DELETE /api/admin/servers/:id
router.delete('/servers/:id', async (req, res) => {
  try {
    await db.query(`DELETE FROM servers WHERE id=$1`, [req.params.id]);
    await db.query(`INSERT INTO moderation_logs (admin_id,action,metadata) VALUES ($1,'delete_server',$2)`,
      [req.session.userId, JSON.stringify({ serverId: req.params.id })]);
    res.json({ message: 'Server deleted' });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
