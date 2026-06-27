require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const cors = require('cors');
const { Server } = require('socket.io');
const { pool } = require('./config/database');
const { apiLimiter } = require('./middleware/rateLimit');
const attachSocketHandlers = require('./socket/handlers');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.BASE_URL || '*', methods: ['GET', 'POST'], credentials: true },
  pingTimeout: 60000,
});

// ─── Session middleware ───────────────────────────────────────────────────────
const sessionMiddleware = session({
  store: new pgSession({ pool, createTableIfMissing: false }),
  secret: process.env.SESSION_SECRET || 'change_this_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    sameSite: 'lax',
  },
  name: 'sigma.sid',
});

// Share session with socket.io
io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});

// ─── Security ─────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.socket.io', 'cdnjs.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'cdnjs.cloudflare.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com', 'cdnjs.cloudflare.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
    },
  },
}));
app.use(cors({ origin: process.env.BASE_URL || true, credentials: true }));
app.use(sessionMiddleware);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(apiLimiter);

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Share io with routes
app.set('io', io);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/servers', require('./routes/servers'));
app.use('/api/channels', require('./routes/messages'));
app.use('/api/dms', require('./routes/dms'));
app.use('/api/friends', require('./routes/friends'));
app.use('/api/store', require('./routes/store'));
app.use('/api/notifications', require('./routes/notifications'));

// ─── Page routes ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (req.session?.userId) return res.redirect('/app.html');
  res.redirect('/login.html');
});

app.get('/app', (req, res) => res.redirect('/app.html'));

// ─── Socket.IO ────────────────────────────────────────────────────────────────
attachSocketHandlers(io);

// ─── 404 handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.accepts('html')) return res.sendFile(path.join(__dirname, 'public', '404.html'));
  res.status(404).json({ error: 'Not found' });
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sigma Chat running on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
