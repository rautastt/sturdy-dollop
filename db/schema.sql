-- Sigma Chat — PostgreSQL Schema
-- Run this file in your database before starting the server.
-- psql -d your_database -f db/schema.sql

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  username        VARCHAR(32)  UNIQUE NOT NULL,
  display_name    VARCHAR(64),
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  avatar          TEXT,
  banner          TEXT,
  bio             TEXT DEFAULT '',
  status          VARCHAR(20)  DEFAULT 'online',
  custom_status   VARCHAR(128) DEFAULT '',
  email_verified  BOOLEAN      DEFAULT FALSE,
  verified_at     TIMESTAMPTZ,
  is_admin        BOOLEAN      DEFAULT FALSE,
  is_banned       BOOLEAN      DEFAULT FALSE,
  ban_reason      TEXT,
  badge_blue      BOOLEAN      DEFAULT FALSE,
  badge_gold      BOOLEAN      DEFAULT FALSE,
  badge_rail      BOOLEAN      DEFAULT FALSE,
  badge_admin     BOOLEAN      DEFAULT FALSE,
  points          INTEGER      DEFAULT 0,
  xp              INTEGER      DEFAULT 0,
  level           INTEGER      DEFAULT 1,
  name_color      VARCHAR(20)  DEFAULT '',
  theme           VARCHAR(30)  DEFAULT 'default',
  chat_effect     VARCHAR(30)  DEFAULT '',
  created_at      TIMESTAMPTZ  DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  DEFAULT NOW(),
  last_seen       TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(LOWER(username));
CREATE INDEX IF NOT EXISTS idx_users_email    ON users(LOWER(email));

-- Session store (used by connect-pg-simple)
CREATE TABLE IF NOT EXISTS session (
  sid    VARCHAR      NOT NULL PRIMARY KEY,
  sess   JSONB        NOT NULL,
  expire TIMESTAMPTZ  NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);

-- Email tokens
CREATE TABLE IF NOT EXISTS email_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(128) UNIQUE NOT NULL,
  type       VARCHAR(30) NOT NULL,  -- 'verify','reset','change_email'
  new_email  VARCHAR(255),
  used       BOOLEAN DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_tokens_token ON email_tokens(token);

-- Servers
CREATE TABLE IF NOT EXISTS servers (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description TEXT DEFAULT '',
  icon        TEXT,
  owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  invite_code VARCHAR(20) UNIQUE NOT NULL,
  is_public   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Server members
CREATE TABLE IF NOT EXISTS server_members (
  server_id  INTEGER REFERENCES servers(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role       VARCHAR(20) DEFAULT 'member', -- 'owner','admin','moderator','member'
  nickname   VARCHAR(64),
  joined_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (server_id, user_id)
);

-- Channels
CREATE TABLE IF NOT EXISTS channels (
  id         SERIAL PRIMARY KEY,
  server_id  INTEGER REFERENCES servers(id) ON DELETE CASCADE,
  name       VARCHAR(64) NOT NULL,
  type       VARCHAR(20) DEFAULT 'text',  -- 'text','voice','announcement'
  topic      TEXT DEFAULT '',
  position   INTEGER DEFAULT 0,
  is_nsfw    BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_channels_server ON channels(server_id);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  channel_id  INTEGER REFERENCES channels(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content     TEXT NOT NULL,
  attachments JSONB DEFAULT '[]',
  reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  is_pinned   BOOLEAN DEFAULT FALSE,
  is_deleted  BOOLEAN DEFAULT FALSE,
  edited_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at DESC);

-- Pinned messages
CREATE TABLE IF NOT EXISTS pinned_messages (
  channel_id  INTEGER REFERENCES channels(id) ON DELETE CASCADE,
  message_id  INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  pinned_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  pinned_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (channel_id, message_id)
);

-- Message reactions
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  emoji      VARCHAR(64) NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

-- DM channels
CREATE TABLE IF NOT EXISTS dm_channels (
  id         SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dm_participants (
  dm_channel_id INTEGER REFERENCES dm_channels(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (dm_channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS dm_messages (
  id            SERIAL PRIMARY KEY,
  dm_channel_id INTEGER REFERENCES dm_channels(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content       TEXT NOT NULL,
  is_deleted    BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dm_messages ON dm_messages(dm_channel_id, created_at DESC);

-- Group DMs
CREATE TABLE IF NOT EXISTS groups (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  icon       TEXT,
  owner_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id   INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_messages (
  id         SERIAL PRIMARY KEY,
  group_id   INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content    TEXT NOT NULL,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Friends
CREATE TABLE IF NOT EXISTS friends (
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  friend_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, friend_id)
);

CREATE TABLE IF NOT EXISTS friend_requests (
  id          SERIAL PRIMARY KEY,
  sender_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  status      VARCHAR(20) DEFAULT 'pending',  -- 'pending','accepted','declined'
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (sender_id, receiver_id)
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type       VARCHAR(50) NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  is_read    BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC);

-- Store purchases
CREATE TABLE IF NOT EXISTS store_purchases (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  item       VARCHAR(100) NOT NULL,
  cost       INTEGER NOT NULL,
  purchased_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, item)
);

-- Bans
CREATE TABLE IF NOT EXISTS bans (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  username     VARCHAR(32),
  email        VARCHAR(255),
  reason       TEXT NOT NULL,
  banned_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_active    BOOLEAN DEFAULT TRUE,
  unbanned_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Timeouts (server-level mutes)
CREATE TABLE IF NOT EXISTS timeouts (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  server_id  INTEGER REFERENCES servers(id) ON DELETE CASCADE,
  reason     TEXT,
  until      TIMESTAMPTZ NOT NULL,
  issued_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Moderation logs
CREATE TABLE IF NOT EXISTS moderation_logs (
  id         SERIAL PRIMARY KEY,
  admin_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     VARCHAR(100) NOT NULL,
  reason     TEXT,
  metadata   JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_modlogs_created ON moderation_logs(created_at DESC);
