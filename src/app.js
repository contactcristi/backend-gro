const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const express = require('express');
const jwt = require('jsonwebtoken');

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_DAYS = 30;
const BCRYPT_COST = 12;

function sendError(res, status, code, message, details = {}) {
  return res.status(status).json({
    error: {
      code,
      message,
      details,
    },
  });
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function passwordStrength(password) {
  const value = String(password || '');
  let score = 0;
  if (value.length >= 8) score += 1;
  if (/[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  return score;
}

function createRefreshToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashRefreshToken(refreshToken) {
  return crypto.createHash('sha256').update(refreshToken).digest('hex');
}

function refreshTokenExpiresAt() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);
  return expiresAt;
}

async function issueTokens(accountStore, userId, jwtSecret, request) {
  const accessToken = jwt.sign({ sub: userId }, jwtSecret, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
  const refreshToken = createRefreshToken();

  await accountStore.saveRefreshToken({
    userId,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: refreshTokenExpiresAt(),
    userAgent: request.get('user-agent') || null,
    ip: request.ip || null,
  });

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    token_type: 'Bearer',
  };
}

function validateRegisterBody(body) {
  const name = String(body.name || '').trim();
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');

  if (name.length < 2) {
    return { code: 'invalid_name', message: 'Name must be at least 2 characters.', field: 'name' };
  }
  if (!isValidEmail(email)) {
    return { code: 'invalid_email', message: 'Email must be valid.', field: 'email' };
  }
  if (passwordStrength(password) < 2) {
    return {
      code: 'weak_password',
      message: 'Password must reach the mobile app strength score of at least 2.',
      field: 'password',
    };
  }
  if (body.accept_terms !== true) {
    return {
      code: 'terms_required',
      message: 'Terms and Privacy acceptance is required.',
      field: 'accept_terms',
    };
  }

  return null;
}

function authenticate(jwtSecret) {
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return sendError(res, 401, 'auth_required', 'Bearer token is required.');
    }

    try {
      const payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
      req.auth = { userId: payload.sub };
      return next();
    } catch (error) {
      return sendError(res, 401, 'invalid_token', 'Bearer token is invalid or expired.');
    }
  };
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createApp({ accountStore, jwtSecret, pool }) {
  if (!accountStore) throw new Error('accountStore is required');
  if (!jwtSecret) throw new Error('jwtSecret is required');

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/', (req, res) => {
    res.send('<h1>Groadmin Dashboard</h1><p>Serverul este online și pregătit pentru date!</p>');
  });

  app.get('/healthz', (req, res) => {
    res.json({ status: 'ok' });
  });

  if (pool) {
    app.get('/test-db', asyncRoute(async (req, res) => {
      const result = await pool.query('SELECT NOW()');
      res.json({ success: true, db_time: result.rows[0].now, message: 'Conexiune reușită!' });
    }));
  }

  app.post('/v1/auth/register', asyncRoute(async (req, res) => {
    const validationError = validateRegisterBody(req.body || {});
    if (validationError) {
      return sendError(res, 400, validationError.code, validationError.message, {
        field: validationError.field,
      });
    }

    const email = normalizeEmail(req.body.email);
    const passwordHash = await bcrypt.hash(String(req.body.password), BCRYPT_COST);

    let me;
    try {
      me = await accountStore.createRegisteredUser({
        email,
        passwordHash,
        name: String(req.body.name).trim(),
        termsVersion: String(req.body.terms_version || '2026-04-28'),
        privacyVersion: String(req.body.privacy_version || '2026-04-28'),
      });
    } catch (error) {
      if (error.code === '23505') {
        return sendError(res, 409, 'email_taken', 'Email is already registered.', { field: 'email' });
      }
      throw error;
    }

    const tokens = await issueTokens(accountStore, me.user.id, jwtSecret, req);
    return res.status(201).json({ data: { ...tokens, user: me } });
  }));

  app.post('/v1/auth/login', asyncRoute(async (req, res) => {
    const email = normalizeEmail(req.body && req.body.email);
    const password = String((req.body && req.body.password) || '');

    if (!isValidEmail(email) || !password) {
      return sendError(res, 400, 'invalid_credentials', 'Email and password are required.');
    }

    const user = await accountStore.findUserByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return sendError(res, 401, 'invalid_credentials', 'Email or password is incorrect.');
    }

    await accountStore.recordLogin(user.id);
    const me = await accountStore.getMe(user.id);
    const tokens = await issueTokens(accountStore, user.id, jwtSecret, req);
    return res.json({ data: { ...tokens, user: me } });
  }));

  app.get('/v1/me', authenticate(jwtSecret), asyncRoute(async (req, res) => {
    const me = await accountStore.getMe(req.auth.userId);
    if (!me) {
      return sendError(res, 404, 'user_not_found', 'Authenticated user was not found.');
    }
    return res.json({ data: me });
  }));

  app.use((err, req, res, next) => {
    console.error(err);
    return sendError(res, 500, 'internal_error', 'Unexpected server error.');
  });

  return app;
}

module.exports = {
  ACCESS_TOKEN_TTL_SECONDS,
  BCRYPT_COST,
  createApp,
  hashRefreshToken,
  passwordStrength,
};
