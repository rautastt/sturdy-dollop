# Sigma Chat

A full Discord-inspired community platform built with Node.js, Express, Socket.IO, PostgreSQL, and Vanilla JS.

---

## Features

- **Authentication** — Register, login, logout with bcrypt + session-based auth
- **Email verification** — Token-based email verification with 24-hour expiry; resend available
- **Password reset** — Secure email-based password reset (1-hour expiry)
- **Email change** — Verified email change flow
- **Servers & Channels** — Create/join/leave servers, text channels, invite codes
- **Real-time Chat** — Socket.IO-powered messaging with typing indicators and presence
- **Direct Messages** — 1-on-1 DMs and group chats
- **Friends** — Friend requests, accept/decline, friend list
- **User Profiles** — Avatar, banner, bio, badges, XP, level, points, name color
- **Message features** — Edit, delete, pin/unpin, reactions, reply threads
- **Economy** — +1 point & +5 XP per message, level system
- **Store** — Buy Rail subscription, themes, name colors, banners, chat effects
- **Moderation** — Ban, unban, kick, timeout, delete messages, grant/remove badges, adjust points, reset XP
- **Account settings** — Change password, change email, view/terminate sessions
- **Rate limiting** — Per-route limits on auth, email, API, and messages
- **Security** — Helmet, CSRF protection, input validation, prepared queries, XSS escaping

---

## Quick Start

### 1. Prerequisites

- **Node.js 18+** — https://nodejs.org
- **PostgreSQL 14+** — https://postgresql.org (or use [Supabase](https://supabase.com))
- An **SMTP email account** — Gmail with App Passwords works well

### 2. Install dependencies

```bash
npm install
```

### 3. Set up the database

Create a PostgreSQL database:

```bash
psql -U postgres -c "CREATE DATABASE sigma_chat;"
```

Then run the schema:

```bash
psql -U postgres -d sigma_chat -f db/schema.sql
```

Or with a full connection string:

```bash
psql "postgresql://user:password@localhost:5432/sigma_chat" -f db/schema.sql
```

**Supabase:** paste the contents of `db/schema.sql` into the Supabase SQL editor and run it.

### 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Your PostgreSQL connection string
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/sigma_chat

# A long random string (use: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
SESSION_SECRET=your_very_long_random_secret_here

# The URL people use to access the app (for email links)
BASE_URL=http://localhost:3000

# SMTP — Gmail example
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-gmail@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx   # Gmail App Password (16 chars)
EMAIL_FROM=Sigma Chat <your-gmail@gmail.com>
```

#### Setting up Gmail App Passwords

1. Enable 2-Factor Authentication on your Google account
2. Go to https://myaccount.google.com/apppasswords
3. Create an App Password for "Mail" → "Other" → name it "Sigma Chat"
4. Use the 16-character code as `SMTP_PASS`

#### Other SMTP providers

| Provider | SMTP_HOST | SMTP_PORT | Notes |
|----------|-----------|-----------|-------|
| Gmail | smtp.gmail.com | 587 | Requires App Password |
| SendGrid | smtp.sendgrid.net | 587 | SMTP_USER=apikey, SMTP_PASS=your_api_key |
| Mailgun | smtp.mailgun.org | 587 | — |
| Outlook | smtp-mail.outlook.com | 587 | — |
| Custom | your.smtp.host | 587 | — |

### 5. Run the app

**Development:**

```bash
npm run dev
```

**Production:**

```bash
npm start
```

Open http://localhost:3000

---

## Admin Account

The schema seeds a default admin account:

| Field | Value |
|-------|-------|
| Username | `Admin` |
| Password | `whatthesigma` |
| Badges | Blue ✓, Gold, Admin |

**Change the password immediately after first login via Settings → My Account.**

---

## Production Deployment

1. Set `NODE_ENV=production` in `.env`
2. Set `BASE_URL` to your public domain (e.g. `https://sigma.example.com`)
3. Use a process manager: `npm install -g pm2 && pm2 start server.js --name sigma-chat`
4. Put Nginx in front as a reverse proxy:

```nginx
server {
    listen 80;
    server_name sigma.example.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

5. Add SSL with Certbot: `certbot --nginx -d sigma.example.com`
6. Set `SMTP_SECURE=true` and `SMTP_PORT=465` if using SSL SMTP

---

## File Structure

```
sigma-chat/
├── server.js              # Main Express + Socket.IO server
├── config/
│   ├── database.js        # PostgreSQL connection pool
│   └── email.js           # Nodemailer transporter & email templates
├── middleware/
│   ├── auth.js            # requireAuth, requireAdmin, requireVerified
│   └── rateLimit.js       # Rate limiters per route type
├── routes/
│   ├── auth.js            # Register, login, logout, email verification, password reset
│   ├── users.js           # Profile, avatar, moderation actions
│   ├── servers.js         # Server & channel management
│   ├── messages.js        # Channel messages, reactions, pins
│   ├── dms.js             # Direct messages & group chats
│   ├── friends.js         # Friend requests & management
│   ├── store.js           # Economy store
│   └── notifications.js   # Notification system
├── socket/
│   └── handlers.js        # Socket.IO event handlers (presence, typing, etc.)
├── utils/
│   └── nanoid.js          # Invite code generator
├── public/
│   ├── login.html         # Login page
│   ├── register.html      # Registration page
│   ├── reset-password.html # Password reset page
│   ├── app.html           # Main app (Discord-style layout)
│   ├── 404.html           # 404 page
│   ├── css/
│   │   ├── main.css       # Base styles, auth, modals
│   │   └── app.css        # App layout styles
│   ├── js/
│   │   └── app.js         # Full client-side app logic
│   └── uploads/           # User-uploaded files (auto-created)
└── db/
    └── schema.sql         # Full PostgreSQL schema + admin seed
```

---

## Troubleshooting

**Emails not sending?**
- Check `SMTP_USER`, `SMTP_PASS`, `SMTP_HOST` in `.env`
- For Gmail, use an App Password (not your regular password)
- Check spam folder
- Test with `node -e "require('./config/email').sendVerificationEmail('test@example.com','Test','tok123')"`

**Can't connect to database?**
- Verify `DATABASE_URL` is correct
- Ensure PostgreSQL is running: `pg_ctl status` or `sudo systemctl status postgresql`
- Ensure the database exists: `psql -c "\l"`

**Port already in use?**
- Change `PORT` in `.env` to another port (e.g. `3001`)

**Sessions not persisting?**
- Ensure the `session` table exists (it's in the schema)
- Check `SESSION_SECRET` is set
