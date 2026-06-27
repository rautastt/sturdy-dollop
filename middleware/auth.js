function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.redirect('/login.html');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session?.userId || !req.session?.isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

function requireVerified(req, res, next) {
  if (!req.session?.emailVerified) {
    return res.status(403).json({ error: 'Email verification required', code: 'EMAIL_NOT_VERIFIED' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireVerified };
