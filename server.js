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
// Trust Render's load balancer (first proxy) so express-rate-limit accepts X-Forwarded-For
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ['GET','POST'], credentials: true },
  pingTimeout: 60000,
});

const sessionMiddleware = session({
  store: new pgSession({ pool, createTableIfMissing: false }),
  secret: process.env.SESSION_SECRET || 'dev_secret_change_me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  },
  name: 'sigma.sid',
});

io.use((socket, next) => sessionMiddleware(socket.request, socket.request.res || {}, next));

// Content Security Policy: allow cdnjs for socket.io client and (temporary) inline event handlers
// SECURITY: Allowing 'unsafe-inline' for script attributes weakens CSP. This is a temporary compatibility fix
// to avoid breaking behavior from inline onclick/oninput handlers in public/app.html. Recommend refactoring
// inline handlers into external scripts or using nonces, then removing scriptSrcAttr 'unsafe-inline'.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Allow script from self and cdnjs (socket.io client)
      scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
      // Temp: allow inline event handler attributes (onclick/oninput). Remove after refactor.
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      // Allow websocket endpoints and cdn for source maps
      connectSrc: ["'self'", 'ws:', 'wss:', 'https://cdnjs.cloudflare.com'],
    },
  },
}));
app.use(cors({ origin: true, credentials: true }));
app.use(sessionMiddleware);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(apiLimiter);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.set('io', io);

app.use('/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/servers', require('./routes/servers'));
app.use('/api/channels', require('./routes/messages'));
app.use('/api/dms', require('./routes/dms'));
app.use('/api/friends', require('./routes/friends'));
app.use('/api/store', require('./routes/store'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/admin', require('./routes/admin'));

app.get('/', (req, res) => res.redirect(req.session?.userId ? '/app.html' : '/login.html'));
app.get('/app', (req, res) => res.redirect('/app.html'));

attachSocketHandlers(io);

app.use((req, res) => {
  if (req.accepts('html')) return res.sendFile(path.join(__dirname, 'public', '404.html'));
  res.status(404).json({ error: 'Not found' });
});
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Sigma Chat running at http://localhost:${PORT}`);
  console.log(`📧 Email: ${process.env.EMAIL_ENABLED === 'true' ? 'ENABLED' : 'DISABLED (tokens printed to console)'}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}\n`);
});
