const db = require('../config/database');

module.exports = function attachSocketHandlers(io) {
  io.use((socket, next) => {
    const session = socket.request.session;
    if (!session?.userId) return next(new Error('Unauthorized'));
    socket.userId = session.userId;
    socket.username = session.username;
    next();
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;

    // Join personal room
    socket.join(`user:${userId}`);

    // Update presence
    await db.query(`UPDATE users SET status = CASE WHEN status = 'invisible' THEN 'invisible' ELSE 'online' END, last_seen = NOW() WHERE id = $1`, [userId]);
    io.emit('presence:update', { userId, status: 'online' });

    // Join channels for all servers the user belongs to
    try {
      const memberships = await db.query(
        `SELECT c.id AS channel_id, sm.server_id FROM server_members sm
         JOIN channels c ON c.server_id = sm.server_id
         WHERE sm.user_id = $1`,
        [userId]
      );
      for (const { channel_id, server_id } of memberships.rows) {
        socket.join(`channel:${channel_id}`);
        socket.join(`server:${server_id}`);
      }

      // Join DM rooms
      const dms = await db.query(
        `SELECT dm_channel_id FROM dm_participants WHERE user_id = $1`, [userId]
      );
      for (const { dm_channel_id } of dms.rows) {
        socket.join(`dm:${dm_channel_id}`);
      }

      // Join group rooms
      const groups = await db.query(
        `SELECT group_id FROM group_members WHERE user_id = $1`, [userId]
      );
      for (const { group_id } of groups.rows) {
        socket.join(`group:${group_id}`);
      }
    } catch (err) {
      console.error('Socket join rooms error:', err);
    }

    // ─── Channel events ─────────────────────────────────────────────────────
    socket.on('channel:join', async (channelId) => {
      const access = await db.query(
        `SELECT c.id FROM channels c JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = $1 WHERE c.id = $2`,
        [userId, channelId]
      );
      if (access.rows.length) socket.join(`channel:${channelId}`);
    });

    // ─── Typing indicators ──────────────────────────────────────────────────
    socket.on('typing:start', ({ channelId }) => {
      socket.to(`channel:${channelId}`).emit('typing:start', { userId, username: socket.username, channelId });
    });

    socket.on('typing:stop', ({ channelId }) => {
      socket.to(`channel:${channelId}`).emit('typing:stop', { userId, channelId });
    });

    socket.on('typing:start:dm', ({ dmChannelId }) => {
      socket.to(`dm:${dmChannelId}`).emit('typing:start:dm', { userId, username: socket.username, dmChannelId });
    });

    socket.on('typing:stop:dm', ({ dmChannelId }) => {
      socket.to(`dm:${dmChannelId}`).emit('typing:stop:dm', { userId, dmChannelId });
    });

    // ─── DM room join ───────────────────────────────────────────────────────
    socket.on('dm:join', async (dmChannelId) => {
      const access = await db.query(`SELECT * FROM dm_participants WHERE dm_channel_id = $1 AND user_id = $2`, [dmChannelId, userId]);
      if (access.rows.length) socket.join(`dm:${dmChannelId}`);
    });

    socket.on('group:join', async (groupId) => {
      const access = await db.query(`SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`, [groupId, userId]);
      if (access.rows.length) socket.join(`group:${groupId}`);
    });

    // ─── Status change ──────────────────────────────────────────────────────
    socket.on('status:set', async (status) => {
      const valid = ['online', 'idle', 'dnd', 'invisible'];
      if (!valid.includes(status)) return;
      await db.query(`UPDATE users SET status = $1 WHERE id = $2`, [status, userId]);
      io.emit('presence:update', { userId, status: status === 'invisible' ? 'offline' : status });
    });

    // ─── Disconnect ─────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      // Check if user has other sockets connected
      const sockets = await io.in(`user:${userId}`).fetchSockets();
      if (sockets.length === 0) {
        await db.query(`UPDATE users SET last_seen = NOW() WHERE id = $1`, [userId]);
        const userStatus = await db.query(`SELECT status FROM users WHERE id = $1`, [userId]);
        const offlineStatus = userStatus.rows[0]?.status === 'invisible' ? 'offline' : 'offline';
        io.emit('presence:update', { userId, status: offlineStatus });
      }
    });
  });
};
