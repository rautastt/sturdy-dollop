-- Sigma Chat Database Schema
-- Run this file against your PostgreSQL database to set up all tables.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id               SERIAL PRIMARY KEY,
  username         VARCHAR(32)  UNIQUE NOT NULL,
  display_name     VARCHAR(64),
  email            VARCHAR(255) UNIQUE NOT NULL,
  password_hash    TEXT         NOT NULL,
  avatar           TEXT,
  banner           TEXT,
  bio              TEXT         DEFAULT '',
  status           VARCHAR(16)  DEFAULT 'online' CHECK (status IN ('online','idle','dnd','invisible')),
  custom_status    VARCHAR(128) DEFAULT '',
  email_verified   BOOLEAN      DEFAULT FALSE,
  verified_at      TIMESTAMPTZ,
  is_admin         BOOLEAN      DEFAULT FALSE,
  is_banned        BOOLEAN      DEFAULT FALSE,
  ban_reason       TEXT,
  badge_blue       BOOLEAN      DEFAULT FALSE,
  badge_gold       BOOLEAN      DEFAULT FALSE,
  badge_rail       BOOLEAN      DEFAULT FALSE,
  badge_admin      BOOLEAN      DEFAULT FALSE,
  points           INTEGER      DEFAULT 0,
  xp               INTEGER      DEFAULT 0,
  level            INTEGER      DEFAULT 1,
  name_color       VARCHAR(16)  DEFAULT '#ffffff',
  theme            VARCHAR(32)  DEFAULT 'dark',
  chat_effect      VARCHAR(32)  DEFAULT '',
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  DEFAULT NOW(),
  last_seen        TIMESTAMPTZ  DEFAULT NOW()
);

-- ─── Sessions (managed by connect-pg-simple) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS session (
  sid    VARCHAR    NOT NULL COLLATE "default",
  sess   JSON       NOT NULL,
  expire TIMESTAMP  NOT NULL,
  PRIMARY KEY (sid)
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);

-- ─── Email Tokens ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER      REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT         UNIQUE NOT NULL,
  type       VARCHAR(32)  NOT NULL CHECK (type IN ('verify','reset','change_email')),
  new_email  TEXT,
  expires_at TIMESTAMPTZ  NOT NULL,
  used       BOOLEAN      DEFAULT FALSE,
  created_at TIMESTAMPTZ  DEFAULT NOW()
);

-- ─── Servers ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS servers (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description TEXT         DEFAULT '',
  icon        TEXT,
  banner      TEXT,
  owner_id    INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  invite_code VARCHAR(16)  UNIQUE,
  is_public   BOOLEAN      DEFAULT TRUE,
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- ─── Server Members ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS server_members (
  id        SERIAL PRIMARY KEY,
  server_id INTEGER  REFERENCES servers(id) ON DELETE CASCADE,
  user_id   INTEGER  REFERENCES users(id)   ON DELETE CASCADE,
  role      VARCHAR(16) DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  nickname  VARCHAR(64),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(server_id, user_id)
);

-- ─── Channels ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channels (
  id         SERIAL PRIMARY KEY,
  server_id  INTEGER     REFERENCES servers(id) ON DELETE CASCADE,
  name       VARCHAR(64) NOT NULL,
  type       VARCHAR(16) DEFAULT 'text' CHECK (type IN ('text','voice','announcement')),
  topic      TEXT        DEFAULT '',
  position   INTEGER     DEFAULT 0,
  is_nsfw    BOOLEAN     DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Messages ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id           SERIAL PRIMARY KEY,
  channel_id   INTEGER     REFERENCES channels(id) ON DELETE CASCADE,
  user_id      INTEGER     REFERENCES users(id)    ON DELETE SET NULL,
  content      TEXT        NOT NULL,
  attachments  JSONB       DEFAULT '[]',
  reply_to_id  INTEGER     REFERENCES messages(id) ON DELETE SET NULL,
  is_pinned    BOOLEAN     DEFAULT FALSE,
  is_deleted   BOOLEAN     DEFAULT FALSE,
  edited_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Direct Messages ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dm_channels (
  id         SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dm_participants (
  dm_channel_id INTEGER REFERENCES dm_channels(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id)       ON DELETE CASCADE,
  PRIMARY KEY (dm_channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS dm_messages (
  id            SERIAL PRIMARY KEY,
  dm_channel_id INTEGER     REFERENCES dm_channels(id) ON DELETE CASCADE,
  user_id       INTEGER     REFERENCES users(id)       ON DELETE SET NULL,
  content       TEXT        NOT NULL,
  attachments   JSONB       DEFAULT '[]',
  is_deleted    BOOLEAN     DEFAULT FALSE,
  read_at       TIMESTAMPTZ,
  edited_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Group Chats ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS groups (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  icon       TEXT,
  owner_id   INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id  INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  user_id   INTEGER REFERENCES users(id)  ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_messages (
  id          SERIAL PRIMARY KEY,
  group_id    INTEGER     REFERENCES groups(id) ON DELETE CASCADE,
  user_id     INTEGER     REFERENCES users(id)  ON DELETE SET NULL,
  content     TEXT        NOT NULL,
  attachments JSONB       DEFAULT '[]',
  is_deleted  BOOLEAN     DEFAULT FALSE,
  edited_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Friends ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS friend_requests (
  id          SERIAL PRIMARY KEY,
  sender_id   INTEGER     REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER     REFERENCES users(id) ON DELETE CASCADE,
  status      VARCHAR(16) DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sender_id, receiver_id)
);

CREATE TABLE IF NOT EXISTS friends (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER  REFERENCES users(id) ON DELETE CASCADE,
  friend_id  INTEGER  REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);

-- ─── Notifications ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER     REFERENCES users(id) ON DELETE CASCADE,
  type       VARCHAR(32) NOT NULL,
  title      TEXT        NOT NULL,
  body       TEXT        DEFAULT '',
  link       TEXT        DEFAULT '',
  is_read    BOOLEAN     DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Bans ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bans (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  username    VARCHAR(32),
  email       VARCHAR(255),
  ip          TEXT,
  reason      TEXT,
  banned_by   INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  is_active   BOOLEAN     DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  unbanned_at TIMESTAMPTZ
);

-- ─── Moderation Logs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS moderation_logs (
  id          SERIAL PRIMARY KEY,
  admin_id    INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  target_id   INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(64) NOT NULL,
  reason      TEXT        DEFAULT '',
  metadata    JSONB       DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Pinned Messages ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pinned_messages (
  channel_id  INTEGER     REFERENCES channels(id)  ON DELETE CASCADE,
  message_id  INTEGER     REFERENCES messages(id)  ON DELETE CASCADE,
  pinned_by   INTEGER     REFERENCES users(id)     ON DELETE SET NULL,
  pinned_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (channel_id, message_id)
);

-- ─── Timeouts ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS timeouts (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER     REFERENCES users(id) ON DELETE CASCADE,
  server_id  INTEGER     REFERENCES servers(id) ON DELETE CASCADE,
  until      TIMESTAMPTZ NOT NULL,
  reason     TEXT,
  by_user_id INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Store / Subscriptions ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER     REFERENCES users(id) ON DELETE CASCADE,
  type       VARCHAR(32) NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS store_purchases (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER     REFERENCES users(id) ON DELETE CASCADE,
  item       VARCHAR(64) NOT NULL,
  cost       INTEGER     NOT NULL,
  metadata   JSONB       DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Reactions ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_reactions (
  id         SERIAL PRIMARY KEY,
  message_id INTEGER     REFERENCES messages(id) ON DELETE CASCADE,
  user_id    INTEGER     REFERENCES users(id)    ON DELETE CASCADE,
  emoji      VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_messages_channel    ON messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_messages_channel ON dm_messages(dm_channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_members_server      ON server_members(server_id);
CREATE INDEX IF NOT EXISTS idx_members_user        ON server_members(user_id);
CREATE INDEX IF NOT EXISTS idx_email_tokens_token  ON email_tokens(token);
CREATE INDEX IF NOT EXISTS idx_notifications_user  ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_friends_user        ON friends(user_id);

-- ─── Admin seed user ──────────────────────────────────────────────────────────
-- Password: whatthesigma  (bcrypt hash, 10 rounds)
INSERT INTO users (
  username, display_name, email, password_hash,
  email_verified, verified_at, is_admin,
  badge_blue, badge_gold, badge_admin,
  status
) VALUES (
  'Admin',
  'Admin',
  'admin@sigmachat.local',
  '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  TRUE,
  NOW(),
  TRUE,
  TRUE, TRUE, TRUE,
  'online'
) ON CONFLICT (username) DO NOTHING;
