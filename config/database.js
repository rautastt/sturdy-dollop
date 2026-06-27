const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => console.error('Idle client error', err));

async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}

async function getClient() {
  const client = await pool.connect();
  const release = client.release.bind(client);
  const timeout = setTimeout(() => console.error('Client checked out >5s'), 5000);
  client.release = () => { clearTimeout(timeout); release(); };
  return client;
}

module.exports = { query, getClient, pool };
