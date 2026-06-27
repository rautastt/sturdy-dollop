const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();

const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { messageLimiter } = require('../middleware/rateLimit');

const XP_PER_MSG = 5;
const POINTS_PER_MSG = 1;
const XP_PER_LEVEL = 100;

async function addEconomy(userId) {
  await db.query(
    `UPDATE users SET
       points = points + ${POINTS_PER_MSG},
       xp = xp + ${XP_PER_MSG},
       level = FLOOR((xp + ${XP_PER_MSG}) / ${XP_PER_LEVEL}) + 1
     WHERE id = $1`,
    [userId]
  );
}

async function canAccessChannel(channelId, userId) {
  const r = await db.query(
    `SELECT c.id, c.server_id FROM channels c
     JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = $1
     WHERE c.id = $2`,
    [userId, channelId]
  );
  return r.rows[0] || null;
}

// GET /api/channels/:id/messages
router.get('/:id/messages', requireAuth, async (req, res) => {
  const channelId = parseInt(req.params.id);
  const access = await canAccessChannel(channelId, req.session.userId);
  if (!access) return res.status(403).json({ error: 'Cannot access this channel' });

  const before = req.query.before ? parseInt(req.query.before) : null;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);

  try {
    const r = await db.query(
      `SELECT m.id, m.channel_id, m.content, m.attachments, m.reply_to_id, m.is_pinned, m.edited_at, m.created_at,
              u.id AS user_id, u.username, u.display_name, u.avatar, u.badge_blue, u.badge_gold, u.badge_rail, u.badge_admin, u.name_color,
              (SELECT json_agg(json_build_object('emoji', mr.emoji, 'count', count(*), 'me', bool_or(mr.user_id = $3)))
               FROM message_reactions mr WHERE mr.message_id = m.id GROUP BY mr.emoji) AS reactions,
              (SELECT row_to_json(rm) FROM (
                SELECT rm.id, rm.content, ru.username AS author FROM messages rm
                JOIN users ru ON ru.id = rm.user_id WHERE rm.id = m.reply_to_id
              ) rm) AS reply_message
       FROM messages m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.channel_id = $1 AND m.is_deleted = FALSE
         AND ($2::int IS NULL OR m.id < $2)
       ORDER BY m.created_at DESC LIMIT $4`,
      [channelId, before, req.session.userId, limit]
    );
    res.json(r.rows.reverse());
  } catch (err) {
    console.error('Fetch messages error:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST /api/channels/:id/messages
router.post('/:id/messages', requireAuth, messageLimiter, [
  body('content').trim().isLength({ min: 1, max: 2000 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const channelId = parseInt(req.params.id);
  const access = await canAccessChannel(channelId, req.session.userId);
  if (!access) return res.status(403).json({ error: 'Cannot access this channel' });

  // Check timeout
  const timeout = await db.query(
    `SELECT until FROM timeouts WHERE user_id = $1 AND server_id = $2 AND until > NOW() ORDER BY until DESC LIMIT 1`,
    [req.session.userId, access.server_id]
  );
  if (timeout.rows.length) {
    return res.status(403).json({ error: `You are timed out until ${new Date(timeout.rows[0].until).toLocaleString()}` });
  }

  const { content, replyToId } = req.body;
  try {
    const r = await db.query(
      `INSERT INTO messages (channel_id, user_id, content, reply_to_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [channelId, req.session.userId, content, replyToId || null]
    );
    const msg = r.rows[0];
    await addEconomy(req.session.userId);
    const full = await db.query(
      `SELECT m.*, u.id AS user_id, u.username, u.display_name, u.avatar, u.badge_blue, u.badge_gold, u.badge_rail, u.badge_admin, u.name_color
       FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = $1`,
      [msg.id]
    );
    req.app.get('io').to(`channel:${channelId}`).emit('message:new', full.rows[0]);
    res.status(201).json(full.rows[0]);
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// DELETE /api/channels/:id/messages/:msgId
router.delete('/:id/messages/:msgId', requireAuth, async (req, res) => {
  const { id: channelId, msgId } = req.params;
  const access = await canAccessChannel(parseInt(channelId), req.session.userId);
  if (!access) return res.status(403).json({ error: 'Cannot access this channel' });

  const msg = await db.query(`SELECT user_id FROM messages WHERE id = $1 AND channel_id = $2`, [msgId, channelId]);
  if (!msg.rows.length) return res.status(404).json({ error: 'Message not found' });

  const isAuthor = msg.rows[0].user_id === req.session.userId;
  const isAdmin = req.session.isAdmin;
  const memberRow = await db.query(`SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2`, [access.server_id, req.session.userId]);
  const isServerAdmin = memberRow.rows[0]?.role === 'admin' || memberRow.rows[0]?.role === 'owner';

  if (!isAuthor && !isAdmin && !isServerAdmin) return res.status(403).json({ error: 'Cannot delete this message' });

  await db.query(`UPDATE messages SET is_deleted = TRUE WHERE id = $1`, [msgId]);
  req.app.get('io').to(`channel:${channelId}`).emit('message:delete', { id: parseInt(msgId), channelId: parseInt(channelId) });
  if (!isAuthor) {
    await db.query(`INSERT INTO moderation_logs (admin_id, target_id, action, metadata) VALUES ($1, $2, 'delete_message', $3)`,
      [req.session.userId, msg.rows[0].user_id, JSON.stringify({ messageId: msgId, channelId })]);
  }
  res.json({ message: 'Deleted' });
});

// PUT /api/channels/:id/messages/:msgId — edit
router.put('/:id/messages/:msgId', requireAuth, [
  body('content').trim().isLength({ min: 1, max: 2000 }),
], async (req, res) => {
  const { id: channelId, msgId } = req.params;
  const msg = await db.query(`SELECT user_id FROM messages WHERE id = $1 AND channel_id = $2`, [msgId, channelId]);
  if (!msg.rows.length) return res.status(404).json({ error: 'Message not found' });
  if (msg.rows[0].user_id !== req.session.userId) return res.status(403).json({ error: 'Cannot edit this message' });
  const r = await db.query(
    `UPDATE messages SET content = $1, edited_at = NOW() WHERE id = $2 RETURNING *`,
    [req.body.content, msgId]
  );
  req.app.get('io').to(`channel:${channelId}`).emit('message:edit', r.rows[0]);
  res.json(r.rows[0]);
});

// POST /api/channels/:id/messages/:msgId/pin
router.post('/:id/messages/:msgId/pin', requireAuth, async (req, res) => {
  const { id: channelId, msgId } = req.params;
  const access = await canAccessChannel(parseInt(channelId), req.session.userId);
  if (!access) return res.status(403).json({ error: 'No access' });
  const memberRow = await db.query(`SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2`, [access.server_id, req.session.userId]);
  if (!memberRow.rows[0] || (memberRow.rows[0].role === 'member' && !req.session.isAdmin)) return res.status(403).json({ error: 'Insufficient permissions' });
  await db.query(`UPDATE messages SET is_pinned = TRUE WHERE id = $1`, [msgId]);
  await db.query(`INSERT INTO pinned_messages (channel_id, message_id, pinned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [channelId, msgId, req.session.userId]);
  req.app.get('io').to(`channel:${channelId}`).emit('message:pinned', { messageId: parseInt(msgId), channelId: parseInt(channelId) });
  res.json({ message: 'Pinned' });
});

// DELETE /api/channels/:id/messages/:msgId/pin
router.delete('/:id/messages/:msgId/pin', requireAuth, async (req, res) => {
  const { id: channelId, msgId } = req.params;
  await db.query(`UPDATE messages SET is_pinned = FALSE WHERE id = $1`, [msgId]);
  await db.query(`DELETE FROM pinned_messages WHERE channel_id = $1 AND message_id = $2`, [channelId, msgId]);
  req.app.get('io').to(`channel:${channelId}`).emit('message:unpinned', { messageId: parseInt(msgId), channelId: parseInt(channelId) });
  res.json({ message: 'Unpinned' });
});

// GET /api/channels/:id/pinned
router.get('/:id/pinned', requireAuth, async (req, res) => {
  const channelId = parseInt(req.params.id);
  const access = await canAccessChannel(channelId, req.session.userId);
  if (!access) return res.status(403).json({ error: 'No access' });
  const r = await db.query(
    `SELECT m.*, u.username, u.display_name, u.avatar FROM messages m
     JOIN users u ON u.id = m.user_id
     WHERE m.channel_id = $1 AND m.is_pinned = TRUE AND m.is_deleted = FALSE`,
    [channelId]
  );
  res.json(r.rows);
});

// POST /api/channels/:id/messages/:msgId/react
router.post('/:id/messages/:msgId/react', requireAuth, [
  body('emoji').trim().isLength({ min: 1, max: 32 }),
], async (req, res) => {
  const { id: channelId, msgId } = req.params;
  const access = await canAccessChannel(parseInt(channelId), req.session.userId);
  if (!access) return res.status(403).json({ error: 'No access' });
  const { emoji } = req.body;
  try {
    await db.query(
      `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [msgId, req.session.userId, emoji]
    );
    req.app.get('io').to(`channel:${channelId}`).emit('message:react', { messageId: parseInt(msgId), userId: req.session.userId, emoji });
    res.json({ message: 'Reacted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to react' });
  }
});

// DELETE /api/channels/:id/messages/:msgId/react/:emoji
router.delete('/:id/messages/:msgId/react/:emoji', requireAuth, async (req, res) => {
  const { id: channelId, msgId, emoji } = req.params;
  await db.query(`DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`, [msgId, req.session.userId, emoji]);
  req.app.get('io').to(`channel:${channelId}`).emit('message:unreact', { messageId: parseInt(msgId), userId: req.session.userId, emoji });
  res.json({ message: 'Removed' });
});

module.exports = router;
