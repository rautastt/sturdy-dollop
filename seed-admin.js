/**
 * Run this script once after setting up the database to ensure the
 * Admin account has the correct password: whatthesigma
 *
 *   node seed-admin.js
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function seed() {
  const hash = await bcrypt.hash('whatthesigma', 12);
  const client = await pool.connect();
  try {
    const existing = await client.query(`SELECT id FROM users WHERE LOWER(username) = 'admin'`);
    if (existing.rows.length) {
      await client.query(`UPDATE users SET password_hash = $1 WHERE LOWER(username) = 'admin'`, [hash]);
      console.log('✅ Admin password updated to: whatthesigma');
    } else {
      await client.query(
        `INSERT INTO users (username, display_name, email, password_hash, email_verified, verified_at, is_admin, badge_blue, badge_gold, badge_admin, status)
         VALUES ('Admin','Admin','admin@sigmachat.local',$1,TRUE,NOW(),TRUE,TRUE,TRUE,TRUE,'online')`,
        [hash]
      );
      console.log('✅ Admin account created. Username: Admin | Password: whatthesigma');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => { console.error('❌ Seed failed:', err.message); process.exit(1); });
