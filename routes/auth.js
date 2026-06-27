const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const router = express.Router();

const db = require('../config/database');
const { sendVerificationEmail, sendPasswordResetEmail, sendChangeEmailVerification, EMAIL_ENABLED } = require('../config/email');
const { requireAuth } = require('../middleware/auth');
const { authLimiter, emailLimiter } = require('../middleware/rateLimit');

const SALT_ROUNDS = 12;

async function createEmailToken(userId, type, newEmail = null) {
  const token = uuidv4() + uuidv4();
  const hours = type === 'reset' ? 1 : 24;
  await db.query(`UPDATE email_tokens SET used=TRUE WHERE user_id=$1 AND type=$2 AND used=FALSE`, [userId, type]);
  await db.query(
    `INSERT INTO email_tokens (user_id,token,type,new_email,expires_at) VALUES ($1,$2,$3,$4,NOW()+$5::interval)`,
    [userId, token, type, newEmail, `${hours} hours`]
  );
  return token;
}

// POST /auth/register
router.post('/register', authLimiter, [
  body('username').trim().isLength({ min:2, max:32 }).matches(/^[a-zA-Z0-9_.\-]+$/),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min:8 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { username, email, password } = req.body;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT id FROM users WHERE LOWER(username)=LOWER($1) OR LOWER(email)=LOWER($2)`, [username, email]
    );
    if (existing.rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Username or email already taken' }); }
    const ban = await client.query(`SELECT id FROM bans WHERE LOWER(email)=LOWER($1) AND is_active=TRUE`, [email]);
    if (ban.rows.length) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'This email is banned' }); }
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await client.query(
      `INSERT INTO users (username,display_name,email,password_hash,email_verified,verified_at)
       VALUES ($1,$1,$2,$3,$4,$5) RETURNING id,username,email`,
      [username, email, hash, !EMAIL_ENABLED, !EMAIL_ENABLED ? new Date() : null]
    );
    const user = result.rows[0];
    await client.query('COMMIT');
    if (EMAIL_ENABLED) {
      const token = await createEmailToken(user.id, 'verify');
      await sendVerificationEmail(email, username, token);
      return res.status(201).json({ message: 'Registered! Check your email to verify your account.' });
    }
    // Email disabled — auto-verified, log them in directly
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.isAdmin = false;
    req.session.emailVerified = true;
    res.status(201).json({ message: 'Registered!', autoLogin: true, user: { id: user.id, username: user.username } });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  } finally {
    client.release();
  }
});

// POST /auth/login
router.post('/login', authLimiter, [
  body('login').trim().notEmpty(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { login, password } = req.body;
  try {
    const result = await db.query(
      `SELECT id,username,email,password_hash,email_verified,is_admin,is_banned,ban_reason,status,avatar,display_name
       FROM users WHERE LOWER(email)=LOWER($1) OR LOWER(username)=LOWER($1)`, [login]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.is_banned) return res.status(403).json({ error: `Account banned: ${user.ban_reason || 'Policy violation'}` });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.isAdmin = user.is_admin;
    req.session.emailVerified = user.email_verified;
    await db.query(`UPDATE users SET last_seen=NOW(),status=CASE WHEN status='invisible' THEN 'invisible' ELSE 'online' END WHERE id=$1`, [user.id]);
    res.json({ user: { id:user.id, username:user.username, displayName:user.display_name, avatar:user.avatar, emailVerified:user.email_verified, isAdmin:user.is_admin } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /auth/logout
router.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.clearCookie('sigma.sid'));
  res.json({ message: 'Logged out' });
});

// GET /auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id,username,display_name,email,avatar,banner,bio,status,custom_status,
              email_verified,is_admin,badge_blue,badge_gold,badge_rail,badge_admin,
              points,xp,level,name_color,theme,chat_effect,created_at,last_seen
       FROM users WHERE id=$1`, [req.session.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch user' }); }
});

// GET /auth/verify-email
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/login.html?error=invalid_token');
  try {
    const result = await db.query(
      `SELECT et.*,u.username FROM email_tokens et JOIN users u ON u.id=et.user_id
       WHERE et.token=$1 AND et.type='verify' AND et.used=FALSE AND et.expires_at>NOW()`, [token]
    );
    if (!result.rows.length) return res.redirect('/login.html?error=invalid_or_expired_token');
    const row = result.rows[0];
    await db.query(`UPDATE users SET email_verified=TRUE,verified_at=NOW() WHERE id=$1`, [row.user_id]);
    await db.query(`UPDATE email_tokens SET used=TRUE WHERE id=$1`, [row.id]);
    if (req.session?.userId === row.user_id) req.session.emailVerified = true;
    res.redirect('/login.html?verified=1');
  } catch (err) { console.error(err); res.redirect('/login.html?error=server_error'); }
});

// POST /auth/resend-verification
router.post('/resend-verification', emailLimiter, requireAuth, async (req, res) => {
  if (!EMAIL_ENABLED) return res.status(400).json({ error: 'Email is disabled on this server' });
  try {
    const result = await db.query(`SELECT id,username,email,email_verified FROM users WHERE id=$1`, [req.session.userId]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (user.email_verified) return res.status(400).json({ error: 'Email already verified' });
    const token = await createEmailToken(user.id, 'verify');
    await sendVerificationEmail(user.email, user.username, token);
    res.json({ message: 'Verification email sent' });
  } catch (err) { res.status(500).json({ error: 'Failed to send' }); }
});

// POST /auth/forgot-password
router.post('/forgot-password', emailLimiter, [body('email').isEmail().normalizeEmail()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  res.json({ message: 'If that email exists, a reset link has been sent (check server console if email is disabled).' });
  try {
    const result = await db.query(`SELECT id,username,email FROM users WHERE LOWER(email)=LOWER($1) AND is_banned=FALSE`, [req.body.email]);
    if (!result.rows.length) return;
    const user = result.rows[0];
    const token = await createEmailToken(user.id, 'reset');
    await sendPasswordResetEmail(user.email, user.username, token);
  } catch (err) { console.error('Forgot password error:', err); }
});

// GET /auth/reset-password
router.get('/reset-password', (req, res) => res.sendFile('reset-password.html', { root: './public' }));

// POST /auth/reset-password
router.post('/reset-password', authLimiter, [
  body('token').notEmpty(),
  body('password').isLength({ min:8 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { token, password } = req.body;
  try {
    const result = await db.query(
      `SELECT et.* FROM email_tokens et WHERE et.token=$1 AND et.type='reset' AND et.used=FALSE AND et.expires_at>NOW()`, [token]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'Invalid or expired token' });
    const row = result.rows[0];
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await db.query(`UPDATE users SET password_hash=$1 WHERE id=$2`, [hash, row.user_id]);
    await db.query(`UPDATE email_tokens SET used=TRUE WHERE id=$1`, [row.id]);
    await db.query(`DELETE FROM session WHERE (sess->>'userId')::text=$1::text`, [String(row.user_id)]);
    res.json({ message: 'Password reset! You can now log in.' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to reset password' }); }
});

// POST /auth/change-email
router.post('/change-email', requireAuth, emailLimiter, [
  body('newEmail').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { newEmail, password } = req.body;
  try {
    const result = await db.query(`SELECT id,username,email,password_hash FROM users WHERE id=$1`, [req.session.userId]);
    const user = result.rows[0];
    if (!await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ error: 'Incorrect password' });
    const taken = await db.query(`SELECT id FROM users WHERE LOWER(email)=LOWER($1) AND id!=$2`, [newEmail, user.id]);
    if (taken.rows.length) return res.status(409).json({ error: 'Email already in use' });
    const token = await createEmailToken(user.id, 'change_email', newEmail);
    await sendChangeEmailVerification(newEmail, user.username, token);
    res.json({ message: EMAIL_ENABLED ? 'Confirmation sent to your new email.' : 'Email change confirmed (email disabled — check server console).' });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// GET /auth/confirm-email-change
router.get('/confirm-email-change', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/app.html?error=invalid_token');
  try {
    const result = await db.query(
      `SELECT * FROM email_tokens WHERE token=$1 AND type='change_email' AND used=FALSE AND expires_at>NOW()`, [token]
    );
    if (!result.rows.length) return res.redirect('/login.html?error=invalid_or_expired_token');
    const row = result.rows[0];
    await db.query(`UPDATE users SET email=$1,email_verified=TRUE,verified_at=NOW() WHERE id=$2`, [row.new_email, row.user_id]);
    await db.query(`UPDATE email_tokens SET used=TRUE WHERE id=$1`, [row.id]);
    if (req.session?.userId === row.user_id) req.session.emailVerified = true;
    res.redirect('/app.html?email_changed=1');
  } catch (err) { res.redirect('/login.html?error=server_error'); }
});

// POST /auth/logout-all
router.post('/logout-all', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  await db.query(`DELETE FROM session WHERE (sess->>'userId')::text=$1::text`, [String(userId)]);
  req.session.destroy(() => {});
  res.json({ message: 'All sessions terminated' });
});

module.exports = router;
