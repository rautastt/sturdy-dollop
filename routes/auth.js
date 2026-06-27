const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const router = express.Router();

const db = require('../config/database');
const { sendVerificationEmail, sendPasswordResetEmail, sendChangeEmailVerification } = require('../config/email');
const { requireAuth } = require('../middleware/auth');
const { authLimiter, emailLimiter } = require('../middleware/rateLimit');

const SALT_ROUNDS = 12;
const VERIFY_EXPIRY_HOURS = 24;
const RESET_EXPIRY_HOURS = 1;

async function createEmailToken(userId, type, newEmail = null) {
  const token = uuidv4() + uuidv4();
  const hours = type === 'reset' ? RESET_EXPIRY_HOURS : VERIFY_EXPIRY_HOURS;
  await db.query(
    `UPDATE email_tokens SET used = TRUE WHERE user_id = $1 AND type = $2 AND used = FALSE`,
    [userId, type]
  );
  await db.query(
    `INSERT INTO email_tokens (user_id, token, type, new_email, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + $5::interval)`,
    [userId, token, type, newEmail, `${hours} hours`]
  );
  return token;
}

// POST /auth/register
router.post('/register', authLimiter, [
  body('username').trim().isLength({ min: 2, max: 32 }).matches(/^[a-zA-Z0-9_.-]+$/).withMessage('Username must be 2-32 chars, letters/numbers/._- only'),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { username, email, password } = req.body;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT id FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)`,
      [username, email]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Username or email already taken' });
    }
    const ban = await client.query(
      `SELECT id FROM bans WHERE (LOWER(email) = LOWER($1)) AND is_active = TRUE`,
      [email]
    );
    if (ban.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'This email is banned from Sigma Chat' });
    }
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await client.query(
      `INSERT INTO users (username, display_name, email, password_hash)
       VALUES ($1, $1, $2, $3) RETURNING id, username, email`,
      [username, email, hash]
    );
    const user = result.rows[0];
    const token = await createEmailToken(user.id, 'verify');
    await client.query('COMMIT');
    await sendVerificationEmail(email, username, token);
    res.status(201).json({ message: 'Registered! Check your email to verify your account.' });
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
      `SELECT id, username, email, password_hash, email_verified, is_admin, is_banned, ban_reason, status, avatar, display_name
       FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)`,
      [login]
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

    await db.query(`UPDATE users SET last_seen = NOW(), status = CASE WHEN status = 'invisible' THEN 'invisible' ELSE 'online' END WHERE id = $1`, [user.id]);

    res.json({ user: { id: user.id, username: user.username, displayName: user.display_name, avatar: user.avatar, emailVerified: user.email_verified, isAdmin: user.is_admin } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /auth/logout
router.post('/logout', requireAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out' });
  });
});

// GET /auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, username, display_name, email, avatar, banner, bio, status, custom_status,
              email_verified, is_admin, badge_blue, badge_gold, badge_rail, badge_admin,
              points, xp, level, name_color, theme, chat_effect, created_at, last_seen
       FROM users WHERE id = $1`,
      [req.session.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// GET /auth/verify-email
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/login.html?error=invalid_token');
  try {
    const result = await db.query(
      `SELECT et.*, u.username FROM email_tokens et
       JOIN users u ON u.id = et.user_id
       WHERE et.token = $1 AND et.type = 'verify' AND et.used = FALSE AND et.expires_at > NOW()`,
      [token]
    );
    if (!result.rows.length) return res.redirect('/login.html?error=invalid_or_expired_token');
    const row = result.rows[0];
    await db.query(`UPDATE users SET email_verified = TRUE, verified_at = NOW() WHERE id = $1`, [row.user_id]);
    await db.query(`UPDATE email_tokens SET used = TRUE WHERE id = $1`, [row.id]);
    if (req.session?.userId === row.user_id) req.session.emailVerified = true;
    res.redirect('/login.html?verified=1');
  } catch (err) {
    console.error('Verify email error:', err);
    res.redirect('/login.html?error=server_error');
  }
});

// POST /auth/resend-verification
router.post('/resend-verification', emailLimiter, requireAuth, async (req, res) => {
  try {
    const result = await db.query(`SELECT id, username, email, email_verified FROM users WHERE id = $1`, [req.session.userId]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.email_verified) return res.status(400).json({ error: 'Email already verified' });
    const token = await createEmailToken(user.id, 'verify');
    await sendVerificationEmail(user.email, user.username, token);
    res.json({ message: 'Verification email sent' });
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(500).json({ error: 'Failed to send verification email' });
  }
});

// POST /auth/forgot-password
router.post('/forgot-password', emailLimiter, [
  body('email').isEmail().normalizeEmail(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  // Always respond 200 to avoid leaking whether email exists
  res.json({ message: 'If that email exists, a reset link has been sent.' });
  try {
    const result = await db.query(`SELECT id, username, email FROM users WHERE LOWER(email) = LOWER($1) AND is_banned = FALSE`, [req.body.email]);
    if (!result.rows.length) return;
    const user = result.rows[0];
    const token = await createEmailToken(user.id, 'reset');
    await sendPasswordResetEmail(user.email, user.username, token);
  } catch (err) {
    console.error('Forgot password error:', err);
  }
});

// GET /auth/reset-password — serve form
router.get('/reset-password', (req, res) => {
  res.sendFile('reset-password.html', { root: './public' });
});

// POST /auth/reset-password
router.post('/reset-password', authLimiter, [
  body('token').notEmpty(),
  body('password').isLength({ min: 8 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { token, password } = req.body;
  try {
    const result = await db.query(
      `SELECT et.*, u.username FROM email_tokens et
       JOIN users u ON u.id = et.user_id
       WHERE et.token = $1 AND et.type = 'reset' AND et.used = FALSE AND et.expires_at > NOW()`,
      [token]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'Invalid or expired token' });
    const row = result.rows[0];
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, row.user_id]);
    await db.query(`UPDATE email_tokens SET used = TRUE WHERE id = $1`, [row.id]);
    // Destroy all sessions for user by removing from session table
    await db.query(`DELETE FROM session WHERE sess->>'userId' = $1::text`, [row.user_id]);
    res.json({ message: 'Password reset! You can now log in.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// POST /auth/change-email — request email change
router.post('/change-email', requireAuth, emailLimiter, [
  body('newEmail').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { newEmail, password } = req.body;
  try {
    const result = await db.query(`SELECT id, username, email, password_hash FROM users WHERE id = $1`, [req.session.userId]);
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Incorrect password' });
    const taken = await db.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2`, [newEmail, user.id]);
    if (taken.rows.length) return res.status(409).json({ error: 'That email is already in use' });
    const token = await createEmailToken(user.id, 'change_email', newEmail);
    await sendChangeEmailVerification(newEmail, user.username, token);
    res.json({ message: 'Confirmation email sent to your new address.' });
  } catch (err) {
    console.error('Change email error:', err);
    res.status(500).json({ error: 'Failed to initiate email change' });
  }
});

// GET /auth/confirm-email-change
router.get('/confirm-email-change', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/app.html?error=invalid_token');
  try {
    const result = await db.query(
      `SELECT * FROM email_tokens WHERE token = $1 AND type = 'change_email' AND used = FALSE AND expires_at > NOW()`,
      [token]
    );
    if (!result.rows.length) return res.redirect('/login.html?error=invalid_or_expired_token');
    const row = result.rows[0];
    await db.query(`UPDATE users SET email = $1, email_verified = TRUE, verified_at = NOW() WHERE id = $2`, [row.new_email, row.user_id]);
    await db.query(`UPDATE email_tokens SET used = TRUE WHERE id = $1`, [row.id]);
    if (req.session?.userId === row.user_id) req.session.emailVerified = true;
    res.redirect('/app.html?email_changed=1');
  } catch (err) {
    console.error('Confirm email change error:', err);
    res.redirect('/login.html?error=server_error');
  }
});

// POST /auth/logout-all — log out all sessions
router.post('/logout-all', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  try {
    await db.query(`DELETE FROM session WHERE (sess->>'userId')::int = $1`, [userId]);
    req.session.destroy(() => {});
    res.json({ message: 'All sessions terminated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to terminate sessions' });
  }
});

module.exports = router;
