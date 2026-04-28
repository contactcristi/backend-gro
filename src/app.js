const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const express = require('express');
const jwt = require('jsonwebtoken');

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_DAYS = 30;
const BCRYPT_COST = 12;
const PAYMENT_METHODS = new Set(['Bank transfer', 'Standing order', 'Direct debit', 'Cash', 'Other']);

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

function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateProfileUpdates(body) {
  const updates = {};

  if (body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (name.length < 2) {
      return { error: { code: 'invalid_name', message: 'Name must be at least 2 characters.', field: 'name' } };
    }
    updates.name = name;
  }

  if (body.email !== undefined) {
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email) || email.length < 5) {
      return { error: { code: 'invalid_email', message: 'Email must be valid.', field: 'email' } };
    }
    updates.email = email;
  }

  if (body.dob !== undefined) {
    if (!isRealDate(body.dob)) {
      return { error: { code: 'invalid_dob', message: 'DOB must be a real YYYY-MM-DD date.', field: 'dob' } };
    }
    updates.dob = body.dob;
  }

  if (body.nationality !== undefined) {
    updates.nationality = String(body.nationality || '').trim();
  }

  if (Object.keys(updates).length === 0) {
    return { error: { code: 'empty_update', message: 'At least one profile field is required.' } };
  }

  return { updates };
}

function validateSettingsUpdates(body) {
  const updates = {};
  const booleanFields = [
    'push_rent_reminders',
    'push_passport_updates',
    'push_rewards',
    'push_promos',
    'email_monthly_statement',
  ];

  for (const field of booleanFields) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== 'boolean') {
        return { error: { code: 'invalid_setting', message: `${field} must be boolean.`, field } };
      }
      updates[field] = body[field];
    }
  }

  if (body.language !== undefined) {
    if (!['en-GB', 'en-US'].includes(body.language)) {
      return { error: { code: 'invalid_language', message: 'Language must be en-GB or en-US.', field: 'language' } };
    }
    updates.language = body.language;
  }

  if (Object.keys(updates).length === 0) {
    return { error: { code: 'empty_update', message: 'At least one settings field is required.' } };
  }

  return { updates };
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : Number.NaN;
}

function validateTenancyBody(body) {
  const propertyAddress = String(body.property_address || '').trim();
  const monthlyRent = normalizeMoney(body.monthly_rent);
  const paymentDay = Number(body.payment_day);
  const landlordName = String(body.landlord_name || '').trim();
  const agentName = String(body.agent_name || '').trim();

  if (!propertyAddress) {
    return { error: { code: 'invalid_property_address', message: 'Property address is required.', field: 'property_address' } };
  }
  if (!Number.isFinite(monthlyRent) || monthlyRent <= 0) {
    return { error: { code: 'invalid_monthly_rent', message: 'Monthly rent must be greater than 0.', field: 'monthly_rent' } };
  }
  if (!Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 31) {
    return { error: { code: 'invalid_payment_day', message: 'Payment day must be between 1 and 31.', field: 'payment_day' } };
  }
  if (!landlordName) {
    return { error: { code: 'invalid_landlord_name', message: 'Landlord name is required.', field: 'landlord_name' } };
  }
  if (!isRealDate(body.tenancy_end_date)) {
    return { error: { code: 'invalid_tenancy_end_date', message: 'Tenancy end date must be a real YYYY-MM-DD date.', field: 'tenancy_end_date' } };
  }

  return {
    tenancy: {
      property_address: propertyAddress,
      monthly_rent: monthlyRent,
      payment_day: paymentDay,
      landlord_name: landlordName,
      agent_name: agentName,
      tenancy_end_date: body.tenancy_end_date,
      landlord_email: normalizeOptionalText(body.landlord_email),
      landlord_phone: normalizeOptionalText(body.landlord_phone),
    },
  };
}

function validateManualRentReportBody(body, now) {
  const amount = normalizeMoney(body.amount);

  if (!Number.isFinite(amount) || amount <= 0 || amount > 50000) {
    return { error: { code: 'invalid_amount', message: 'Amount must be greater than 0 and at most 50000.', field: 'amount' } };
  }
  if (!isRealDate(body.payment_date)) {
    return { error: { code: 'invalid_payment_date', message: 'Payment date must be a real YYYY-MM-DD date.', field: 'payment_date' } };
  }
  if (body.payment_date > now().toISOString().slice(0, 10)) {
    return { error: { code: 'invalid_payment_date', message: 'Payment date cannot be in the future.', field: 'payment_date' } };
  }
  if (!PAYMENT_METHODS.has(body.payment_method)) {
    return { error: { code: 'invalid_payment_method', message: 'Payment method is not supported.', field: 'payment_method' } };
  }

  return {
    report: {
      amount,
      payment_date: body.payment_date,
      payment_method: body.payment_method,
      reference: normalizeOptionalText(body.reference),
      notes: normalizeOptionalText(body.notes),
    },
  };
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

function createApp({ accountStore, jwtSecret, pool, now = () => new Date() }) {
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

  app.patch('/v1/me/profile', authenticate(jwtSecret), asyncRoute(async (req, res) => {
    const { updates, error } = validateProfileUpdates(req.body || {});
    if (error) {
      return sendError(res, 400, error.code, error.message, error.field ? { field: error.field } : {});
    }

    try {
      const me = await accountStore.updateProfile(req.auth.userId, updates);
      if (!me) {
        return sendError(res, 404, 'user_not_found', 'Authenticated user was not found.');
      }
      return res.json({ data: me });
    } catch (err) {
      if (err.code === '23505') {
        return sendError(res, 409, 'email_taken', 'Email is already registered.', { field: 'email' });
      }
      throw err;
    }
  }));

  app.patch('/v1/me/settings', authenticate(jwtSecret), asyncRoute(async (req, res) => {
    const { updates, error } = validateSettingsUpdates(req.body || {});
    if (error) {
      return sendError(res, 400, error.code, error.message, error.field ? { field: error.field } : {});
    }

    const me = await accountStore.updateSettings(req.auth.userId, updates);
    if (!me) {
      return sendError(res, 404, 'user_not_found', 'Authenticated user was not found.');
    }
    return res.json({ data: me });
  }));

  app.get('/v1/me/notifications', authenticate(jwtSecret), asyncRoute(async (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '50', 10) || 50, 1), 100);
    const notifications = await accountStore.listNotifications(req.auth.userId, { limit });
    return res.json({ data: { notifications } });
  }));

  app.post('/v1/me/notifications/read-all', authenticate(jwtSecret), asyncRoute(async (req, res) => {
    const updatedCount = await accountStore.markAllNotificationsRead(req.auth.userId);
    return res.json({ data: { updated_count: updatedCount } });
  }));

  app.post('/v1/me/notifications/:id/read', authenticate(jwtSecret), asyncRoute(async (req, res) => {
    const notification = await accountStore.markNotificationRead(req.auth.userId, req.params.id);
    if (!notification) {
      return sendError(res, 404, 'notification_not_found', 'Notification was not found.');
    }
    return res.json({ data: { notification } });
  }));

  app.get('/v1/me/tenancy', authenticate(jwtSecret), asyncRoute(async (req, res) => {
    const tenancy = await accountStore.getTenancy(req.auth.userId);
    if (!tenancy) {
      return sendError(res, 404, 'tenancy_not_found', 'Tenancy was not found.');
    }
    return res.json({ data: { tenancy } });
  }));

  app.put('/v1/me/tenancy', authenticate(jwtSecret), asyncRoute(async (req, res) => {
    const { tenancy, error } = validateTenancyBody(req.body || {});
    if (error) {
      return sendError(res, 400, error.code, error.message, error.field ? { field: error.field } : {});
    }

    const savedTenancy = await accountStore.upsertTenancy(req.auth.userId, tenancy, { now: now() });
    return res.json({ data: { tenancy: savedTenancy } });
  }));

  app.get('/v1/me/rent/payments', authenticate(jwtSecret), asyncRoute(async (req, res) => {
    const payments = await accountStore.listRentPayments(req.auth.userId);
    return res.json({ data: { payments } });
  }));

  app.post('/v1/me/rent/reports/manual', authenticate(jwtSecret), asyncRoute(async (req, res) => {
    const { report, error } = validateManualRentReportBody(req.body || {}, now);
    if (error) {
      return sendError(res, 400, error.code, error.message, error.field ? { field: error.field } : {});
    }

    const rentReport = await accountStore.createManualRentReport(req.auth.userId, report);
    if (!rentReport) {
      return sendError(res, 404, 'tenancy_not_found', 'Create a tenancy before reporting rent.');
    }
    return res.status(201).json({ data: { report: rentReport } });
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
