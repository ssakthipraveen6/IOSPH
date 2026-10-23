/**
 * backend/auth/require_role.js
 *
 * Shared role guard (Phase S). Relies on requireAuth (server.js) having set req.user
 * from the session cookie or Bearer token, and on its CSRF check for cookie sessions.
 * Super Admin always passes.
 */

const SRE_LEAD_PLUS = ['SRE Lead', 'Platform Admin', 'SecOps Admin', 'Super Admin'];

// Express middleware that allows only the given roles (Super Admin always allowed).
function requireRole(...allowedRoles) {
  const roles = allowedRoles.flat();
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (req.user.role === 'Super Admin' || roles.includes(req.user.role)) {
      return next();
    }
    return res.status(403).json({ error: `Access denied. Requires one of roles: ${roles.join(', ')}` });
  };
}

// True when the user has one of the roles.
function hasRole(user, roles) {
  return !!user && (user.role === 'Super Admin' || roles.flat().includes(user.role));
}

module.exports = { requireRole, hasRole, SRE_LEAD_PLUS };
