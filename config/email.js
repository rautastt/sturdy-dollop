const nodemailer = require('nodemailer');

const EMAIL_ENABLED = process.env.EMAIL_ENABLED === 'true';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const FROM = process.env.EMAIL_FROM || 'Sigma Chat <noreply@sigmachat.local>';

let transporter;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

async function maybeSend(to, subject, html) {
  if (!EMAIL_ENABLED) {
    console.log(`\n[EMAIL DISABLED] To: ${to} | Subject: ${subject}\n${html.replace(/<[^>]+>/g,'')}\n`);
    return;
  }
  await getTransporter().sendMail({ from: FROM, to, subject, html });
}

async function sendVerificationEmail(email, username, token) {
  const link = `${BASE}/auth/verify-email?token=${token}`;
  await maybeSend(email, 'Verify your Sigma Chat email', `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#1e1f22;color:#dcddde;padding:32px;border-radius:12px;">
      <h1 style="color:#5865f2">Sigma Chat</h1>
      <h2>Hey ${username}, verify your email</h2>
      <p>Click below to verify your email. Expires in <strong>24 hours</strong>.</p>
      <a href="${link}" style="display:inline-block;background:#5865f2;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;margin:16px 0">Verify Email</a>
      <p style="font-size:13px;color:#96989d">Or copy: <a href="${link}" style="color:#5865f2">${link}</a></p>
    </div>`);
}

async function sendPasswordResetEmail(email, username, token) {
  const link = `${BASE}/auth/reset-password?token=${token}`;
  await maybeSend(email, 'Reset your Sigma Chat password', `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#1e1f22;color:#dcddde;padding:32px;border-radius:12px;">
      <h1 style="color:#5865f2">Sigma Chat</h1>
      <h2>Password Reset</h2>
      <p>Hey ${username} — click below to reset your password. Expires in <strong>1 hour</strong>.</p>
      <a href="${link}" style="display:inline-block;background:#ed4245;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;margin:16px 0">Reset Password</a>
      <p style="font-size:13px;color:#96989d">Or copy: <a href="${link}" style="color:#5865f2">${link}</a></p>
    </div>`);
}

async function sendChangeEmailVerification(newEmail, username, token) {
  const link = `${BASE}/auth/confirm-email-change?token=${token}`;
  await maybeSend(newEmail, 'Confirm your new Sigma Chat email', `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#1e1f22;color:#dcddde;padding:32px;border-radius:12px;">
      <h1 style="color:#5865f2">Sigma Chat</h1>
      <h2>Confirm email change</h2>
      <p>Hey ${username} — click below to confirm your new email. Expires in <strong>24 hours</strong>.</p>
      <a href="${link}" style="display:inline-block;background:#57f287;color:#000;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;margin:16px 0">Confirm New Email</a>
    </div>`);
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendChangeEmailVerification, EMAIL_ENABLED };
