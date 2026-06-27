const express = require('express');
const bcrypt = require('bcrypt');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const router = express.Router();

const db = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const UPLOAD_DIR = process.env.UPLOAD_DIR || './public/uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 5) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  },
});

async function saveImage(buffer, filename, size) {
  const out = path.join(UPLOAD_DIR, filename);
  await sharp(buffer).resize(size, size, { fit: 'cover' }).webp({ quality: 85 }).toFile(out);
  return `/uploads/${filename}`;
}

// GET /api/users/search?q=
router.get('/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);
  try {
    const result = await db.query(
      `SELECT id, username, display_name, avatar, status, badge_blue, badge_gold, badge_rail, badge_admin
       FROM users WHERE (LOWER(username) LIKE LOWER($1) OR LOWER(display_name) LIKE LOWER($1))
         AND is_banned = FALSE AND id != $2
       LIMIT 20`,
      [`%${q}%`, req.session.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET /api/users/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, username, display_name, avatar, banner, bio, status, custom_status,
              badge_blue, badge_gold, badge_rail, badge_admin,
              points, xp, level, name_color, created_at, last_seen,
              (SELECT COUNT(*) FROM friends WHERE user_id = u.id) AS friend_count
       FROM users u WHERE id = $1 AND is_banned = FALSE`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// PUT /api/users/me — update profile fields
router.put('/me', requireAuth, [
  body('displayName').optional().trim().isLength({ max: 64 }),
  body('bio').optional().trim().isLength({ max: 500 }),
  body('customStatus').optional().trim().isLength({ max: 128 }),
  body('status').optional().isIn(['online', 'idle', 'dnd', 'invisible']),
  body('username').optional().trim().isLength({ min: 2, max: 32 }).matches(/^[a-zA-Z0-9_.-]+$/),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { displayName, bio, customStatus, status, username } = req.body;
  try {
    if (username) {
      const user = await db.query(`SELECT email_verified FROM users WHERE id = $1`, [req.session.userId]);
      if (!user.rows[0]?.email_verified) return res.status(403).json({ error: 'Email verification required to change username' });
      const taken = await db.query(`SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2`, [username, req.session.userId]);
      if (taken.rows.length) return res.status(409).json({ error: 'Username already taken' });
    }
    const fields = [];
    const values = [];
    let i = 1;
    if (displayName !== undefined) { fields.push(`display_name = $${i++}`); values.push(displayName); }
    if (bio !== undefined) { fields.push(`bio = $${i++}`); values.push(bio); }
    if (customStatus !== undefined) { fields.push(`custom_status = $${i++}`); values.push(customStatus); }
    if (status !== undefined) { fields.push(`status = $${i++}`); values.push(status); }
    if (username !== undefined) { fields.push(`username = $${i++}`); values.push(username); }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    fields.push(`updated_at = NOW()`);
    values.push(req.session.userId);
    const result = await db.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING id, username, display_name, bio, status, custom_status`,
      values
    );
    if (username) req.session.username = result.rows[0].username;
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// POST /api/users/me/change-password
router.post('/me/change-password', requireAuth, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { currentPassword, newPassword } = req.body;
  try {
    const result = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [req.session.userId]);
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 12);
    await db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, req.session.userId]);
    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// POST /api/users/me/avatar
router.post('/me/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided' });
  try {
    const filename = `avatar_${req.session.userId}_${Date.now()}.webp`;
    const url = await saveImage(req.file.buffer, filename, 256);
    await db.query(`UPDATE users SET avatar = $1 WHERE id = $2`, [url, req.session.userId]);
    res.json({ avatar: url });
  } catch (err) {
    console.error('Avatar upload error:', err);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

// POST /api/users/me/banner
router.post('/me/banner', requireAuth, upload.single('banner'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided' });
  try {
    const out = path.join(UPLOAD_DIR, `banner_${req.session.userId}_${Date.now()}.webp`);
    await sharp(req.file.buffer).resize(1200, 480, { fit: 'cover' }).webp({ quality: 85 }).toFile(out);
    const url = `/uploads/banner_${req.session.userId}_${Date.now()}.webp`;
    await db.query(`UPDATE users SET banner = $1 WHERE id = $2`, [out.replace('./public', ''), req.session.userId]);
    res.json({ banner: out.replace('./public', '') });
  } catch (err) {
    res.status(500).json({ error: 'Failed to upload banner' });
  }
});

// GET /api/users/me/sessions — active session info
router.get('/me/sessions', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT sid, (sess->>'userId') as user_id, expire,
              sess->'cookie' as cookie
       FROM session WHERE (sess->>'userId')::int = $1`,
      [req.session.userId]
    );
    res.json(result.rows.map(r => ({ sid: r.sid, expires: r.expire, current: r.sid === req.sessionID })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// ─── Admin endpoints ──────────────────────────────────────────────────────────

// POST /api/users/:id/ban
router.post('/:id/ban', requireAdmin, [
  body('reason').trim().notEmpty(),
], async (req, res) => {
  const { reason } = req.body;
  const targetId = parseInt(req.params.id);
  if (targetId === req.session.userId) return res.status(400).json({ error: 'Cannot ban yourself' });
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const target = await client.query(`SELECT username, email, is_admin FROM users WHERE id = $1`, [targetId]);
    if (!target.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }
    if (target.rows[0].is_admin) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Cannot ban an admin' }); }
    const { username, email } = target.rows[0];
    await client.query(`UPDATE users SET is_banned = TRUE, ban_reason = $1 WHERE id = $2`, [reason, targetId]);
    await client.query(`DELETE FROM session WHERE (sess->>'userId')::int = $1`, [targetId]);
    await client.query(`DELETE FROM server_members WHERE user_id = $1`, [targetId]);
    await client.query(`DELETE FROM friends WHERE user_id = $1 OR friend_id = $1`, [targetId]);
    await client.query(`DELETE FROM friend_requests WHERE sender_id = $1 OR receiver_id = $1`, [targetId]);
    await client.query(
      `INSERT INTO bans (user_id, username, email, reason, banned_by) VALUES ($1, $2, $3, $4, $5)`,
      [targetId, username, email, reason, req.session.userId]
    );
    await client.query(`INSERT INTO moderation_logs (admin_id, target_id, action, reason) VALUES ($1, $2, 'ban', $3)`, [req.session.userId, targetId, reason]);
    await client.query('COMMIT');
    res.json({ message: 'User banned' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Ban error:', err);
    res.status(500).json({ error: 'Failed to ban user' });
  } finally {
    client.release();
  }
});

// POST /api/users/:id/unban
router.post('/:id/unban', requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.id);
  try {
    await db.query(`UPDATE users SET is_banned = FALSE, ban_reason = NULL WHERE id = $1`, [targetId]);
    await db.query(`UPDATE bans SET is_active = FALSE, unbanned_at = NOW() WHERE user_id = $1 AND is_active = TRUE`, [targetId]);
    await db.query(`INSERT INTO moderation_logs (admin_id, target_id, action) VALUES ($1, $2, 'unban')`, [req.session.userId, targetId]);
    res.json({ message: 'User unbanned' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unban user' });
  }
});

// POST /api/users/:id/kick (remove from server)
router.post('/:id/kick', requireAdmin, [
  body('serverId').isInt(),
  body('reason').optional().trim(),
], async (req, res) => {
  const { serverId, reason } = req.body;
  const targetId = parseInt(req.params.id);
  try {
    await db.query(`DELETE FROM server_members WHERE user_id = $1 AND server_id = $2`, [targetId, serverId]);
    await db.query(`INSERT INTO moderation_logs (admin_id, target_id, action, reason, metadata) VALUES ($1, $2, 'kick', $3, $4)`,
      [req.session.userId, targetId, reason || '', JSON.stringify({ serverId })]);
    res.json({ message: 'User kicked' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to kick user' });
  }
});

// POST /api/users/:id/timeout
router.post('/:id/timeout', requireAdmin, [
  body('serverId').isInt(),
  body('minutes').isInt({ min: 1, max: 10080 }),
  body('reason').optional().trim(),
], async (req, res) => {
  const { serverId, minutes, reason } = req.body;
  const targetId = parseInt(req.params.id);
  try {
    await db.query(
      `INSERT INTO timeouts (user_id, server_id, until, reason, by_user_id)
       VALUES ($1, $2, NOW() + $3::interval, $4, $5)
       ON CONFLICT DO NOTHING`,
      [targetId, serverId, `${minutes} minutes`, reason || '', req.session.userId]
    );
    await db.query(`INSERT INTO moderation_logs (admin_id, target_id, action, reason, metadata) VALUES ($1, $2, 'timeout', $3, $4)`,
      [req.session.userId, targetId, reason || '', JSON.stringify({ serverId, minutes })]);
    res.json({ message: `User timed out for ${minutes} minutes` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to timeout user' });
  }
});

// POST /api/users/:id/badge
router.post('/:id/badge', requireAdmin, [
  body('badge').isIn(['badge_blue', 'badge_gold', 'badge_rail', 'badge_admin']),
  body('grant').isBoolean(),
], async (req, res) => {
  const { badge, grant } = req.body;
  const targetId = parseInt(req.params.id);
  try {
    await db.query(`UPDATE users SET ${badge} = $1 WHERE id = $2`, [grant, targetId]);
    await db.query(`INSERT INTO moderation_logs (admin_id, target_id, action, metadata) VALUES ($1, $2, $3, $4)`,
      [req.session.userId, targetId, grant ? `grant_${badge}` : `remove_${badge}`, '{}']);
    res.json({ message: `Badge ${grant ? 'granted' : 'removed'}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update badge' });
  }
});

// POST /api/users/:id/points
router.post('/:id/points', requireAdmin, [
  body('delta').isInt(),
], async (req, res) => {
  const { delta } = req.body;
  const targetId = parseInt(req.params.id);
  try {
    await db.query(`UPDATE users SET points = GREATEST(0, points + $1) WHERE id = $2`, [delta, targetId]);
    await db.query(`INSERT INTO moderation_logs (admin_id, target_id, action, metadata) VALUES ($1, $2, 'points', $3)`,
      [req.session.userId, targetId, JSON.stringify({ delta })]);
    res.json({ message: 'Points updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update points' });
  }
});

// POST /api/users/:id/reset-xp
router.post('/:id/reset-xp', requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.id);
  try {
    await db.query(`UPDATE users SET xp = 0, level = 1 WHERE id = $1`, [targetId]);
    await db.query(`INSERT INTO moderation_logs (admin_id, target_id, action) VALUES ($1, $2, 'reset_xp')`, [req.session.userId, targetId]);
    res.json({ message: 'XP reset' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset XP' });
  }
});

module.exports = router;
