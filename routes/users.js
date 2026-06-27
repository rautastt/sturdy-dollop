const express = require('express');
const bcrypt = require('bcrypt');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const UPLOAD_DIR = process.env.UPLOAD_DIR || './public/uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 5) * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg','image/png','image/gif','image/webp'].includes(file.mimetype)),
});

// GET /api/users/search?q=
router.get('/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);
  try {
    const r = await db.query(
      `SELECT id,username,display_name,avatar,status,badge_blue,badge_gold,badge_rail,badge_admin
       FROM users WHERE (LOWER(username) LIKE LOWER($1) OR LOWER(display_name) LIKE LOWER($1))
         AND is_banned=FALSE AND id!=$2 LIMIT 20`,
      [`%${q}%`, req.session.userId]
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Search failed' }); }
});

// GET /api/users/me/sessions
router.get('/me/sessions', requireAuth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT sid, expire FROM session WHERE (sess->>'userId')::text=$1::text`, [String(req.session.userId)]
    );
    res.json(r.rows.map(row => ({ sid: row.sid, expires: row.expire, current: row.sid === req.sessionID })));
  } catch (err) { res.status(500).json({ error: 'Failed to fetch sessions' }); }
});

// GET /api/users/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id,username,display_name,avatar,banner,bio,status,custom_status,
              badge_blue,badge_gold,badge_rail,badge_admin,points,xp,level,name_color,created_at,last_seen,
              (SELECT COUNT(*) FROM friends WHERE user_id=u.id) AS friend_count
       FROM users u WHERE id=$1 AND is_banned=FALSE`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// PUT /api/users/me
router.put('/me', requireAuth, [
  body('displayName').optional().trim().isLength({ max:64 }),
  body('bio').optional().trim().isLength({ max:500 }),
  body('customStatus').optional().trim().isLength({ max:128 }),
  body('status').optional().isIn(['online','idle','dnd','invisible']),
  body('username').optional().trim().isLength({ min:2, max:32 }).matches(/^[a-zA-Z0-9_.\-]+$/),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { displayName, bio, customStatus, status, username } = req.body;
  try {
    if (username) {
      const taken = await db.query(`SELECT id FROM users WHERE LOWER(username)=LOWER($1) AND id!=$2`, [username, req.session.userId]);
      if (taken.rows.length) return res.status(409).json({ error: 'Username already taken' });
    }
    const fields = [], values = [];
    let i = 1;
    if (displayName !== undefined) { fields.push(`display_name=$${i++}`); values.push(displayName); }
    if (bio !== undefined) { fields.push(`bio=$${i++}`); values.push(bio); }
    if (customStatus !== undefined) { fields.push(`custom_status=$${i++}`); values.push(customStatus); }
    if (status !== undefined) { fields.push(`status=$${i++}`); values.push(status); }
    if (username !== undefined) { fields.push(`username=$${i++}`); values.push(username); }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    fields.push(`updated_at=NOW()`);
    values.push(req.session.userId);
    const r = await db.query(`UPDATE users SET ${fields.join(',')} WHERE id=$${i} RETURNING id,username,display_name,bio,status,custom_status`, values);
    if (username) req.session.username = r.rows[0].username;
    res.json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to update profile' }); }
});

// POST /api/users/me/change-password
router.post('/me/change-password', requireAuth, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min:8 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const r = await db.query(`SELECT password_hash FROM users WHERE id=$1`, [req.session.userId]);
    if (!await bcrypt.compare(req.body.currentPassword, r.rows[0].password_hash)) return res.status(401).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(req.body.newPassword, 12);
    await db.query(`UPDATE users SET password_hash=$1 WHERE id=$2`, [hash, req.session.userId]);
    res.json({ message: 'Password updated' });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// POST /api/users/me/avatar
router.post('/me/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided' });
  try {
    const filename = `avatar_${req.session.userId}_${Date.now()}.webp`;
    await sharp(req.file.buffer).resize(256,256,{fit:'cover'}).webp({quality:85}).toFile(path.join(UPLOAD_DIR,filename));
    const url = `/uploads/${filename}`;
    await db.query(`UPDATE users SET avatar=$1 WHERE id=$2`, [url, req.session.userId]);
    res.json({ avatar: url });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to upload avatar' }); }
});

// POST /api/users/me/banner
router.post('/me/banner', requireAuth, upload.single('banner'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided' });
  try {
    const filename = `banner_${req.session.userId}_${Date.now()}.webp`;
    await sharp(req.file.buffer).resize(1200,480,{fit:'cover'}).webp({quality:85}).toFile(path.join(UPLOAD_DIR,filename));
    const url = `/uploads/${filename}`;
    await db.query(`UPDATE users SET banner=$1 WHERE id=$2`, [url, req.session.userId]);
    res.json({ banner: url });
  } catch (err) { res.status(500).json({ error: 'Failed to upload banner' }); }
});

module.exports = router;
