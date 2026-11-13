'use strict';

/**
 * backend/auth/issue_session.js
 *
 * Issues a session token, sets httpOnly session cookie and csrf cookie.
 */

const crypto = require('crypto');
const session = require('./session');

/**
 * Issues session cookies and returns tokens.
 * @param {import('express').Response} res
 * @param {object} user
 * @returns {{ token: string, csrfToken: string }}
 */
function issueSession(res, user) {
  const token = session.generateToken(user);
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const isProduction = process.env.NODE_ENV === 'production';

  res.cookie('sentinel_session', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'Strict',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000
  });

  res.cookie('sentinel_csrf', csrfToken, {
    httpOnly: false,
    secure: isProduction,
    sameSite: 'Strict',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000
  });

  return { token, csrfToken };
}

module.exports = {
  issueSession
};
