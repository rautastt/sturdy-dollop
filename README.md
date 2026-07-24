# Sigma Chat (sturdy-dollop)

A self-hostable chat/server application (Sigma Chat) built with Node.js, Express, Socket.IO and PostgreSQL.

This README explains how to get the project running locally, with Docker, and notes for production.

---

## Requirements

- Node.js 18+ (recommended)
- PostgreSQL 13+ (13, 14, 15, 16, 17, 18 all work)
- npm (comes with Node.js)
- Optional: Docker (for running Postgres locally)

## Quickstart — Windows / macOS / Linux (local)

1. Clone the repository

```bash
git clone https://github.com/rautastt/sturdy-dollop.git
cd sturdy-dollop
```

2. Create and edit `.env`

If you don't have a `.env` file, copy the example then edit it:

```bash
cp .env.example .env
# Edit .env: set DATABASE_URL, SESSION_SECRET, SMTP_* etc.
```

Minimum values you should set in `.env`:

- `DATABASE_URL` — Postgres connection string, e.g. `postgresql://sigma:secret@localhost:5432/sigmadb`
- `SESSION_SECRET` — a long random string for session signing
- `PORT` — optional, default 3000
- `NODE_ENV` — `development` or `production`

3. Install dependencies

```bash
npm ci
```

If `npm ci` fails (for example because package-lock.json is missing), run `npm install`.

4. Ensure uploads folder exists

```bash
mkdir -p public/uploads
```

5. Create the database schema and seed admin

```bash
node setup-db.js   # applies db/schema.sql and creates an Admin user
node seed-admin.js # optional: may create/update admin credentials
```

- `setup-db.js` runs `db/schema.sql` and seeds an admin user (default password in the script: `whatthesigma`). Change it after logging in.

6. Start the server

```bash
node server.js
# or run the start.bat on Windows if you've added it
```

Open http://localhost:3000 (or your configured PORT).

---

## Quickstart — Docker (Postgres 18 + local app)

Run Postgres 18 locally with Docker:

```bash
docker run --name sigma-pg -e POSTGRES_PASSWORD=secret -e POSTGRES_USER=sigma -e POSTGRES_DB=sigmadb -p 5432:5432 -d postgres:18
```

Then set in `.env`:

```
DATABASE_URL=postgresql://sigma:secret@localhost:5432/sigmadb
```

Then run the local app as above (npm ci, node setup-db.js, node server.js).

Optional docker-compose (development): create `docker-compose.yml` in the repo root:

```yaml
version: '3.8'
services:
  db:
    image: postgres:18
    environment:
      POSTGRES_USER: sigma
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: sigmadb
    ports:
      - '5432:5432'
    volumes:
      - db_data:/var/lib/postgresql/data

  app:
    image: node:18
    working_dir: /usr/src/app
    volumes:
      - ./:/usr/src/app
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://sigma:secret@db:5432/sigmadb
    ports:
      - '3000:3000'
    command: bash -lc "npm ci && node setup-db.js && node seed-admin.js && node server.js"

volumes:
  db_data:
```

Note: for production build a proper app image rather than bind-mounting source.

---

## Environment variables (important ones)

See `.env.example` for the full list. Key variables:

- DATABASE_URL — Postgres connection string
- SESSION_SECRET — required for session cookies
- PORT — server port (default 3000)
- NODE_ENV — `development` or `production` (affects cookie security and DB ssl handling)
- BASE_URL — used in emails/links
- EMAIL_* / SMTP_* — SMTP host/port/user/pass if you enable email
- UPLOAD_DIR — default `./public/uploads`

## Database notes

- Schema: `db/schema.sql` creates tables and indexes. It uses JSONB and ON CONFLICT (UPSERT). Postgres >= 9.5 supports required features; recommended >= 13.
- `setup-db.js` runs the schema and inserts an admin account. If you prefer to run SQL manually: `psql -d your_db -f db/schema.sql`.
- Sessions: the `session` table used by `connect-pg-simple` is created in the schema. `server.js` has `createTableIfMissing: false`, so ensure the table exists.

## Production considerations

- Use Node 18+ and a process manager (pm2, systemd, or container orchestrator).
- Set `NODE_ENV=production` and a strong `SESSION_SECRET`.
- For cloud Postgres that requires SSL you may need to adjust `config/database.js`. By default the code sets `ssl: { rejectUnauthorized: false }` when not running against localhost.
- Use HTTPS behind a reverse proxy (nginx) and set `trust proxy` appropriately. `server.js` currently uses `app.set('trust proxy', 1)` which is for a single proxy.
- Store uploads on durable storage and secure them.

## Troubleshooting

- DB connection errors: verify `DATABASE_URL`, DB reachable, correct SSL options.
- Missing session cookies in production: ensure HTTPS (secure cookies) or set NODE_ENV=development for testing.
- Schema errors: check you're connected to the intended DB before running `setup-db.js`.

## Useful commands

- Install deps: `npm ci`
- Re-run DB setup: `node setup-db.js`
- Create/update admin: `node seed-admin.js`
- Start server: `node server.js`

---

If you want, I can:
- Commit this updated README to the repository (I just did).
- Add a Dockerfile for the app and a polished `docker-compose.yml` for production.
- Add start scripts for PowerShell / Linux.

