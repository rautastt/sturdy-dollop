const nodemailer = require('nodemailer');

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransporter({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const FROM = process.env.EMAIL_FROM || 'Sigma Chat <noreply@sigmachat.local>';

async function sendVerificationEmail(email, username, token) {
  const link = `${BASE}/auth/verify-email?token=${token}`;
  await getTransporter().sendMail({
    from: FROM,
    to: email,
    subject: 'Verify your Sigma Chat email',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#1e1f22;color:#dcddde;padding:32px;border-radius:12px;">
        <h1 style="color:#5865f2;margin-bottom:8px;">Sigma Chat</h1>
        <h2 style="margin-top:0">Hey ${username}, verify your email</h2>
        <p>Click the button below to verify your email address. This link expires in <strong>24 hours</strong>.</p>
        <a href="${link}" style="display:inline-block;background:#5865f2;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;margin:16px 0;">Verify Email</a>
        <p style="font-size:13px;color:#96989d;">Or copy this link:<br><a href="${link}" style="color:#5865f2;">${link}</a></p>
        <hr style="border-color:#313338;margin:24px 0;">
        <p style="font-size:12px;color:#72767d;">If you didn't create a Sigma Chat account, ignore this email.</p>
      </div>
    `,
  });
}

async function sendPasswordResetEmail(email, username, token) {
  const link = `${BASE}/auth/reset-password?token=${token}`;
  await getTransporter().sendMail({
    from: FROM,
    to: email,
    subject: 'Reset your Sigma Chat password',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#1e1f22;color:#dcddde;padding:32px;border-radius:12px;">
        <h1 style="color:#5865f2;margin-bottom:8px;">Sigma Chat</h1>
        <h2 style="margin-top:0">Password Reset Request</h2>
        <p>Hey ${username}, someone requested a password reset for your account. Click below to set a new password. This link expires in <strong>1 hour</strong>.</p>
        <a href="${link}" style="display:inline-block;background:#ed4245;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;margin:16px 0;">Reset Password</a>
        <p style="font-size:13px;color:#96989d;">Or copy this link:<br><a href="${link}" style="color:#5865f2;">${link}</a></p>
        <hr style="border-color:#313338;margin:24px 0;">
        <p style="font-size:12px;color:#72767d;">If you didn't request this, ignore this email — your password won't change.</p>
      </div>
    `,
  });
}

async function sendChangeEmailVerification(newEmail, username, token) {
  const link = `${BASE}/auth/confirm-email-change?token=${token}`;
  await getTransporter().sendMail({
    from: FROM,
    to: newEmail,
    subject: 'Confirm your new Sigma Chat email',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#1e1f22;color:#dcddde;padding:32px;border-radius:12px;">
        <h1 style="color:#5865f2;margin-bottom:8px;">Sigma Chat</h1>
        <h2 style="margin-top:0">Confirm email change</h2>
        <p>Hey ${username}, confirm your new email address by clicking below. This link expires in <strong>24 hours</strong>.</p>
        <a href="${link}" style="display:inline-block;background:#57f287;color:#000;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;margin:16px 0;">Confirm New Email</a>
        <p style="font-size:13px;color:#96989d;">Or copy this link:<br><a href="${link}" style="color:#5865f2;">${link}</a></p>
        <hr style="border-color:#313338;margin:24px 0;">
        <p style="font-size:12px;color:#72767d;">If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendChangeEmailVerification };
