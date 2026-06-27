# ⚡ Sigma Chat

A Discord-inspired community platform built with Node.js, Express, Socket.IO, and PostgreSQL.

---

## Features

- **Real-time chat** — channels, DMs, group chats, typing indicators, reactions, pinned messages, replies
- **Servers** — create/join servers with invite codes, manage channels, roles
- **Friends** — add friends, accept/decline requests, DM them directly
- **Economy** — earn points and XP by chatting; spend them in the store
- **Store** — buy themes, name colors, chat effects, Rail subscription (no duplicates, items apply instantly)
- **Admin Dashboard** — overview stats, user management, ban/unban, badge grants, moderation logs, server management
- **Email optional** — works with or without SMTP; when disabled, tokens print to the server console

---

## Quick Start

### 1. Extract and install

```bash
tar -xzf sigma-chat.tar.gz
cd sigma-chat
npm install
```

### 2. Set up PostgreSQL

Create a database, then run the schema:

```bash
psql -d your_database -f db/schema.sql
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:
- `DATABASE_URL` — your PostgreSQL connection string
- `SESSION_SECRET` — any long random string

**Email is disabled by default** (`EMAIL_ENABLED=false`). With email disabled:
- New accounts are auto-verified instantly
- Password reset links print to the server console instead of being emailed
- You can enable email by setting `EMAIL_ENABLED=true` and filling in the SMTP fields

### 4. Seed the admin account

```bash
node seed-admin.js
```

This creates (or updates) the admin account:
- **Username:** `Admin`
- **Password:** `whatthesigma`

### 5. Run

```bash
npm start
# or for development with auto-restart:
npm run dev   # requires: npm install -g nodemon
```

Open http://localhost:3000

---

## Admin Dashboard

Log in as Admin and click the 🛡 button at the bottom of the sidebar.

| Tab | What you can do |
|-----|----------------|
| Overview | Live stats — users, servers, messages, active bans |
| Users | Search users, ban/unban, grant/remove badges, adjust points |
| Bans | View all active bans, unban from here |
| Mod Logs | Full audit trail of every moderation action |
| Servers | List all servers with member/channel counts, delete any server |

---

## Store Items

All items have unique IDs — no duplicates. Items take effect immediately on purchase.

| Item | Cost | Effect |
|------|------|--------|
| Rail Subscription | 1000 pts | Grants 🚆 badge |
| Gold/Cyan/Pink/Green/Red Name | 150 pts each | Changes username color in chat |
| Midnight Theme | 200 pts | Deep blue UI theme |
| Sunset Theme | 200 pts | Warm orange UI theme |
| Sparkle Effect | 500 pts | Messages shimmer |
| Confetti Effect | 500 pts | Confetti animation on messages |

---

## Deploying to Render

1. Push code to a GitHub repo
2. Create a **PostgreSQL** database on Render, copy the Internal URL
3. Create a **Web Service** pointing to your repo
   - Build: `npm install`
   - Start: `node server.js`
4. Add environment variables (see `.env.example`)
5. In the Render shell, run: `node seed-admin.js`

> Free tier services sleep after 15 min of inactivity. Upgrade to $7/mo to keep it always on.

---

## File Structure

```
sigma-chat/
├── config/         database.js, email.js
├── db/             schema.sql
├── middleware/     auth.js, rateLimit.js
├── public/         HTML pages, CSS, JS (served statically)
│   ├── css/        app.css
│   ├── js/         app.js
│   └── uploads/    user-uploaded files (auto-created)
├── routes/         auth, users, servers, messages, dms, friends, store, admin, notifications
├── socket/         handlers.js (Socket.IO events)
├── utils/          nanoid.js
├── .env.example
├── package.json
├── seed-admin.js
└── server.js
```
