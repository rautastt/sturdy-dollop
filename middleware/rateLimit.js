const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many email requests, please wait before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: { error: 'Rate limit exceeded.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const messageLimiter = rateLimit({
  windowMs: 5 * 1000,
  max: 10,
  message: { error: 'Slow down! You are sending messages too fast.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { authLimiter, emailLimiter, apiLimiter, messageLimiter };
