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
    socket.join(`user:${userId}`);
    await db.query(`UPDATE users SET status=CASE WHEN status='invisible' THEN 'invisible' ELSE 'online' END, last_seen=NOW() WHERE id=$1`, [userId]);
    io.emit('presence:update', { userId, status: 'online' });

    try {
      const memberships = await db.query(
        `SELECT c.id AS channel_id, sm.server_id FROM server_members sm JOIN channels c ON c.server_id=sm.server_id WHERE sm.user_id=$1`, [userId]
      );
      for (const { channel_id, server_id } of memberships.rows) {
        socket.join(`channel:${channel_id}`);
        socket.join(`server:${server_id}`);
      }
      const dms = await db.query(`SELECT dm_channel_id FROM dm_participants WHERE user_id=$1`, [userId]);
      for (const { dm_channel_id } of dms.rows) socket.join(`dm:${dm_channel_id}`);
      const groups = await db.query(`SELECT group_id FROM group_members WHERE user_id=$1`, [userId]);
      for (const { group_id } of groups.rows) socket.join(`group:${group_id}`);
    } catch (err) { console.error('Socket room join error:', err); }

    socket.on('channel:join', async (channelId) => {
      const access = await db.query(
        `SELECT c.id FROM channels c JOIN server_members sm ON sm.server_id=c.server_id AND sm.user_id=$1 WHERE c.id=$2`, [userId, channelId]
      );
      if (access.rows.length) socket.join(`channel:${channelId}`);
    });

    socket.on('dm:join', async (dmChannelId) => {
      const a = await db.query(`SELECT * FROM dm_participants WHERE dm_channel_id=$1 AND user_id=$2`, [dmChannelId, userId]);
      if (a.rows.length) socket.join(`dm:${dmChannelId}`);
    });

    socket.on('group:join', async (groupId) => {
      const a = await db.query(`SELECT * FROM group_members WHERE group_id=$1 AND user_id=$2`, [groupId, userId]);
      if (a.rows.length) socket.join(`group:${groupId}`);
    });

    socket.on('typing:start', ({ channelId }) => socket.to(`channel:${channelId}`).emit('typing:start', { userId, username: socket.username, channelId }));
    socket.on('typing:stop', ({ channelId }) => socket.to(`channel:${channelId}`).emit('typing:stop', { userId, channelId }));
    socket.on('typing:start:dm', ({ dmChannelId }) => socket.to(`dm:${dmChannelId}`).emit('typing:start:dm', { userId, username: socket.username, dmChannelId }));
    socket.on('typing:stop:dm', ({ dmChannelId }) => socket.to(`dm:${dmChannelId}`).emit('typing:stop:dm', { userId, dmChannelId }));

    socket.on('status:set', async (status) => {
      const valid = ['online','idle','dnd','invisible'];
      if (!valid.includes(status)) return;
      await db.query(`UPDATE users SET status=$1 WHERE id=$2`, [status, userId]);
      io.emit('presence:update', { userId, status: status === 'invisible' ? 'offline' : status });
    });

    socket.on('disconnect', async () => {
      const sockets = await io.in(`user:${userId}`).fetchSockets();
      if (sockets.length === 0) {
        await db.query(`UPDATE users SET last_seen=NOW() WHERE id=$1`, [userId]);
        io.emit('presence:update', { userId, status: 'offline' });
      }
    });
  });
};
