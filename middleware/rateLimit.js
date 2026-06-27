const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 30, message: { error: 'Too many attempts, try later.' }, standardHeaders: true, legacyHeaders: false });
const emailLimiter = rateLimit({ windowMs: 60*60*1000, max: 10, message: { error: 'Too many email requests.' }, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60*1000, max: 300, message: { error: 'Rate limit exceeded.' }, standardHeaders: true, legacyHeaders: false });
const messageLimiter = rateLimit({ windowMs: 5*1000, max: 15, message: { error: 'Slow down!' }, standardHeaders: true, legacyHeaders: false });

module.exports = { authLimiter, emailLimiter, apiLimiter, messageLimiter };
