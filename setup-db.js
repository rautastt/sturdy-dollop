require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const bcrypt = require('bcrypt');

const isLocal = (process.env.DATABASE_URL || '').includes('localhost');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('Running schema...');
    const sql = fs.readFileSync('./db/schema.sql', 'utf8');
    await client.query(sql);
    console.log('✅ Schema applied');
    const hash = await bcrypt.hash('whatthesigma', 12);
    await client.query(`INSERT INTO users (username,display_name,email,password_hash,email_verified,verified_at,is_admin,badge_blue,badge_gold,badge_admin,status)
      VALUES ('Admin','Admin','admin@sigmachat.local',$1,TRUE,NOW(),TRUE,TRUE,TRUE,TRUE,'online')
      ON CONFLICT (username) DO UPDATE SET password_hash=$1,is_admin=TRUE`, [hash]);
    console.log('✅ Admin created — Username: Admin | Password: whatthesigma');
  } catch (err) {
    console.error('❌ Failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
run();