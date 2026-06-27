const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const { nanoid } = require('../utils/nanoid');
const router = express.Router();
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const UPLOAD_DIR = process.env.UPLOAD_DIR || './public/uploads';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5*1024*1024 } });

async function getMembership(serverId, userId) {
  const r = await db.query(`SELECT role FROM server_members WHERE server_id=$1 AND user_id=$2`, [serverId, userId]);
  return r.rows[0] || null;
}

// GET /api/servers
router.get('/', requireAuth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT s.id,s.name,s.icon,s.description,s.invite_code,sm.role,s.owner_id
       FROM servers s JOIN server_members sm ON sm.server_id=s.id AND sm.user_id=$1 ORDER BY s.name`,
      [req.session.userId]
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// POST /api/servers
router.post('/', requireAuth, [body('name').trim().isLength({ min:2, max:100 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { name, description } = req.body;
  const inviteCode = nanoid(8);
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const s = await client.query(`INSERT INTO servers (name,description,owner_id,invite_code) VALUES ($1,$2,$3,$4) RETURNING *`, [name, description||'', req.session.userId, inviteCode]);
    const server = s.rows[0];
    await client.query(`INSERT INTO server_members (server_id,user_id,role) VALUES ($1,$2,'owner')`, [server.id, req.session.userId]);
    await client.query(`INSERT INTO channels (server_id,name,type,position) VALUES ($1,'general','text',0)`, [server.id]);
    await client.query('COMMIT');
    res.status(201).json(server);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to create server' });
  } finally { client.release(); }
});

// GET /api/servers/search?q=
router.get('/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);
  try {
    const r = await db.query(
      `SELECT id,name,icon,description,invite_code,(SELECT COUNT(*) FROM server_members WHERE server_id=s.id) AS member_count
       FROM servers s WHERE is_public=TRUE AND LOWER(name) LIKE LOWER($1) LIMIT 20`, [`%${q}%`]
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Search failed' }); }
});

// POST /api/servers/join
router.post('/join', requireAuth, [body('inviteCode').trim().notEmpty()], async (req, res) => {
  const { inviteCode } = req.body;
  try {
    const s = await db.query(`SELECT * FROM servers WHERE invite_code=$1`, [inviteCode]);
    if (!s.rows.length) return res.status(404).json({ error: 'Invalid invite code' });
    const server = s.rows[0];
    await db.query(`INSERT INTO server_members (server_id,user_id,role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`, [server.id, req.session.userId]);
    res.json(server);
  } catch (err) { res.status(500).json({ error: 'Failed to join' }); }
});

// GET /api/servers/:id
router.get('/:id', requireAuth, async (req, res) => {
  const serverId = parseInt(req.params.id);
  const member = await getMembership(serverId, req.session.userId);
  if (!member) return res.status(403).json({ error: 'Not a member' });
  try {
    const server = await db.query(`SELECT * FROM servers WHERE id=$1`, [serverId]);
    const channels = await db.query(`SELECT * FROM channels WHERE server_id=$1 ORDER BY position,name`, [serverId]);
    const members = await db.query(
      `SELECT u.id,u.username,u.display_name,u.avatar,u.status,u.badge_blue,u.badge_gold,u.badge_rail,u.badge_admin,sm.role,sm.nickname
       FROM server_members sm JOIN users u ON u.id=sm.user_id WHERE sm.server_id=$1 AND u.is_banned=FALSE ORDER BY sm.role,u.username`,
      [serverId]
    );
    res.json({ ...server.rows[0], channels: channels.rows, members: members.rows, myRole: member.role });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// PUT /api/servers/:id
router.put('/:id', requireAuth, async (req, res) => {
  const serverId = parseInt(req.params.id);
  const member = await getMembership(serverId, req.session.userId);
  if (!member || member.role === 'member') return res.status(403).json({ error: 'Insufficient permissions' });
  const { name, description } = req.body;
  const fields = [], vals = []; let i = 1;
  if (name) { fields.push(`name=$${i++}`); vals.push(name); }
  if (description !== undefined) { fields.push(`description=$${i++}`); vals.push(description); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(serverId);
  const r = await db.query(`UPDATE servers SET ${fields.join(',')} WHERE id=$${i} RETURNING *`, vals);
  res.json(r.rows[0]);
});

// POST /api/servers/:id/icon
router.post('/:id/icon', requireAuth, upload.single('icon'), async (req, res) => {
  const serverId = parseInt(req.params.id);
  const member = await getMembership(serverId, req.session.userId);
  if (!member || member.role === 'member') return res.status(403).json({ error: 'Insufficient permissions' });
  if (!req.file) return res.status(400).json({ error: 'No image' });
  const filename = `server_${serverId}_${Date.now()}.webp`;
  await sharp(req.file.buffer).resize(128,128,{fit:'cover'}).webp({quality:85}).toFile(path.join(UPLOAD_DIR,filename));
  const url = `/uploads/${filename}`;
  await db.query(`UPDATE servers SET icon=$1 WHERE id=$2`, [url, serverId]);
  res.json({ icon: url });
});

// DELETE /api/servers/:id/leave
router.delete('/:id/leave', requireAuth, async (req, res) => {
  const serverId = parseInt(req.params.id);
  const member = await getMembership(serverId, req.session.userId);
  if (!member) return res.status(400).json({ error: 'Not a member' });
  if (member.role === 'owner') return res.status(400).json({ error: 'Owner cannot leave. Transfer ownership or delete the server.' });
  await db.query(`DELETE FROM server_members WHERE server_id=$1 AND user_id=$2`, [serverId, req.session.userId]);
  res.json({ message: 'Left server' });
});

// DELETE /api/servers/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const serverId = parseInt(req.params.id);
  const member = await getMembership(serverId, req.session.userId);
  if (!member || member.role !== 'owner') return res.status(403).json({ error: 'Only the owner can delete this server' });
  await db.query(`DELETE FROM servers WHERE id=$1`, [serverId]);
  res.json({ message: 'Deleted' });
});

// POST /api/servers/:id/channels
router.post('/:id/channels', requireAuth, [body('name').trim().isLength({ min:1, max:64 })], async (req, res) => {
  const serverId = parseInt(req.params.id);
  const member = await getMembership(serverId, req.session.userId);
  if (!member || member.role === 'member') return res.status(403).json({ error: 'Insufficient permissions' });
  const { name, type, topic } = req.body;
  const r = await db.query(
    `INSERT INTO channels (server_id,name,type,topic) VALUES ($1,$2,$3,$4) RETURNING *`,
    [serverId, name.toLowerCase().replace(/\s+/g,'-'), type||'text', topic||'']
  );
  res.status(201).json(r.rows[0]);
});

// DELETE /api/servers/:id/channels/:channelId
router.delete('/:id/channels/:channelId', requireAuth, async (req, res) => {
  const serverId = parseInt(req.params.id);
  const member = await getMembership(serverId, req.session.userId);
  if (!member || member.role === 'member') return res.status(403).json({ error: 'Insufficient permissions' });
  await db.query(`DELETE FROM channels WHERE id=$1 AND server_id=$2`, [req.params.channelId, serverId]);
  res.json({ message: 'Channel deleted' });
});

module.exports = router;
