const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { messageLimiter } = require('../middleware/rateLimit');

async function getOrCreateDM(userId1, userId2) {
  const existing = await db.query(
    `SELECT dm.id FROM dm_channels dm
     JOIN dm_participants p1 ON p1.dm_channel_id = dm.id AND p1.user_id = $1
     JOIN dm_participants p2 ON p2.dm_channel_id = dm.id AND p2.user_id = $2`,
    [userId1, userId2]
  );
  if (existing.rows.length) return existing.rows[0].id;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const ch = await client.query(`INSERT INTO dm_channels DEFAULT VALUES RETURNING id`);
    const id = ch.rows[0].id;
    await client.query(`INSERT INTO dm_participants (dm_channel_id, user_id) VALUES ($1, $2), ($1, $3)`, [id, userId1, userId2]);
    await client.query('COMMIT');
    return id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// GET /api/dms — list all DM conversations
router.get('/', requireAuth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT dc.id AS dm_channel_id,
              u.id, u.username, u.display_name, u.avatar, u.status,
              (SELECT content FROM dm_messages WHERE dm_channel_id = dc.id AND is_deleted = FALSE ORDER BY created_at DESC LIMIT 1) AS last_message,
              (SELECT created_at FROM dm_messages WHERE dm_channel_id = dc.id AND is_deleted = FALSE ORDER BY created_at DESC LIMIT 1) AS last_at
       FROM dm_channels dc
       JOIN dm_participants me ON me.dm_channel_id = dc.id AND me.user_id = $1
       JOIN dm_participants other ON other.dm_channel_id = dc.id AND other.user_id != $1
       JOIN users u ON u.id = other.user_id
       WHERE u.is_banned = FALSE
       ORDER BY last_at DESC NULLS LAST`,
      [req.session.userId]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch DMs' });
  }
});

// POST /api/dms/open — open/create DM with user
router.post('/open', requireAuth, async (req, res) => {
  const { userId } = req.body;
  if (!userId || userId === req.session.userId) return res.status(400).json({ error: 'Invalid user' });
  try {
    const dmId = await getOrCreateDM(req.session.userId, parseInt(userId));
    const other = await db.query(`SELECT id, username, display_name, avatar, status FROM users WHERE id = $1`, [userId]);
    res.json({ dmChannelId: dmId, user: other.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to open DM' });
  }
});

// GET /api/dms/:dmId/messages
router.get('/:dmId/messages', requireAuth, async (req, res) => {
  const dmId = parseInt(req.params.dmId);
  const access = await db.query(`SELECT * FROM dm_participants WHERE dm_channel_id = $1 AND user_id = $2`, [dmId, req.session.userId]);
  if (!access.rows.length) return res.status(403).json({ error: 'Cannot access this DM' });
  const before = req.query.before ? parseInt(req.query.before) : null;
  const r = await db.query(
    `SELECT m.id, m.content, m.attachments, m.edited_at, m.created_at, m.is_deleted,
            u.id AS user_id, u.username, u.display_name, u.avatar, u.name_color
     FROM dm_messages m LEFT JOIN users u ON u.id = m.user_id
     WHERE m.dm_channel_id = $1 AND m.is_deleted = FALSE
       AND ($2::int IS NULL OR m.id < $2)
     ORDER BY m.created_at DESC LIMIT 50`,
    [dmId, before]
  );
  res.json(r.rows.reverse());
});

// POST /api/dms/:dmId/messages
router.post('/:dmId/messages', requireAuth, messageLimiter, [
  body('content').trim().isLength({ min: 1, max: 2000 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const dmId = parseInt(req.params.dmId);
  const access = await db.query(`SELECT * FROM dm_participants WHERE dm_channel_id = $1 AND user_id = $2`, [dmId, req.session.userId]);
  if (!access.rows.length) return res.status(403).json({ error: 'No access' });
  const { content } = req.body;
  const r = await db.query(
    `INSERT INTO dm_messages (dm_channel_id, user_id, content) VALUES ($1, $2, $3) RETURNING *`,
    [dmId, req.session.userId, content]
  );
  const full = await db.query(
    `SELECT m.*, u.id AS user_id, u.username, u.display_name, u.avatar, u.name_color
     FROM dm_messages m JOIN users u ON u.id = m.user_id WHERE m.id = $1`,
    [r.rows[0].id]
  );
  req.app.get('io').to(`dm:${dmId}`).emit('dm:message', full.rows[0]);
  res.status(201).json(full.rows[0]);
});

// ─── Groups ────────────────────────────────────────────────────────────────────
// GET /api/dms/groups
router.get('/groups/list', requireAuth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT g.id, g.name, g.icon, g.owner_id,
              (SELECT content FROM group_messages WHERE group_id = g.id ORDER BY created_at DESC LIMIT 1) AS last_message
       FROM groups g JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
       ORDER BY g.created_at DESC`,
      [req.session.userId]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// POST /api/dms/groups — create group chat
router.post('/groups', requireAuth, [
  body('name').trim().isLength({ min: 1, max: 100 }),
  body('memberIds').isArray({ min: 1 }),
], async (req, res) => {
  const { name, memberIds } = req.body;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const g = await client.query(`INSERT INTO groups (name, owner_id) VALUES ($1, $2) RETURNING *`, [name, req.session.userId]);
    const gid = g.rows[0].id;
    const allIds = [req.session.userId, ...memberIds.map(Number)].filter((v, i, a) => a.indexOf(v) === i);
    for (const uid of allIds) {
      await client.query(`INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [gid, uid]);
    }
    await client.query('COMMIT');
    res.status(201).json(g.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to create group' });
  } finally {
    client.release();
  }
});

// GET /api/dms/groups/:id/messages
router.get('/groups/:id/messages', requireAuth, async (req, res) => {
  const gid = parseInt(req.params.id);
  const access = await db.query(`SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`, [gid, req.session.userId]);
  if (!access.rows.length) return res.status(403).json({ error: 'No access' });
  const r = await db.query(
    `SELECT m.*, u.id AS user_id, u.username, u.display_name, u.avatar FROM group_messages m
     JOIN users u ON u.id = m.user_id WHERE m.group_id = $1 AND m.is_deleted = FALSE
     ORDER BY m.created_at DESC LIMIT 50`,
    [gid]
  );
  res.json(r.rows.reverse());
});

// POST /api/dms/groups/:id/messages
router.post('/groups/:id/messages', requireAuth, messageLimiter, [
  body('content').trim().isLength({ min: 1, max: 2000 }),
], async (req, res) => {
  const gid = parseInt(req.params.id);
  const access = await db.query(`SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`, [gid, req.session.userId]);
  if (!access.rows.length) return res.status(403).json({ error: 'No access' });
  const r = await db.query(
    `INSERT INTO group_messages (group_id, user_id, content) VALUES ($1, $2, $3) RETURNING *`,
    [gid, req.session.userId, req.body.content]
  );
  const full = await db.query(
    `SELECT m.*, u.username, u.display_name, u.avatar FROM group_messages m JOIN users u ON u.id = m.user_id WHERE m.id = $1`,
    [r.rows[0].id]
  );
  req.app.get('io').to(`group:${gid}`).emit('group:message', full.rows[0]);
  res.status(201).json(full.rows[0]);
});

module.exports = router;
