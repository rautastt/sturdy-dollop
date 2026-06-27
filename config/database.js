const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV !== 'production' && duration > 100) {
    console.log('Slow query:', { text: text.substring(0, 80), duration, rows: res.rowCount });
  }
  return res;
}

async function getClient() {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const originalRelease = client.release.bind(client);
  const timeout = setTimeout(() => {
    console.error('Client checked out for >5s');
  }, 5000);
  client.query = (...args) => originalQuery(...args);
  client.release = () => {
    clearTimeout(timeout);
    originalRelease();
  };
  return client;
}

module.exports = { query, getClient, pool };
