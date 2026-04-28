const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../src/app');

function createMemoryAccountStore() {
  const usersByEmail = new Map();
  const usersById = new Map();
  const profilesByUserId = new Map();
  const settingsByUserId = new Map();
  const notificationsByUserId = new Map();
  const tenanciesByUserId = new Map();
  const rentPaymentsByUserId = new Map();
  const rentReportsByUserId = new Map();

  return {
    async createRegisteredUser({ email, passwordHash, name, termsVersion, privacyVersion }) {
      const normalizedEmail = email.toLowerCase();
      if (usersByEmail.has(normalizedEmail)) {
        const error = new Error('email already registered');
        error.code = '23505';
        throw error;
      }

      const user = {
        id: `user-${usersByEmail.size + 1}`,
        email: normalizedEmail,
        password_hash: passwordHash,
      };
      usersByEmail.set(normalizedEmail, user);
      usersById.set(user.id, user);
      profilesByUserId.set(user.id, {
        user_id: user.id,
        full_name: name,
        dob: null,
        nationality: '',
        kyc_status: 'pending',
      });
      settingsByUserId.set(user.id, {
        user_id: user.id,
        push_rent_reminders: true,
        push_passport_updates: true,
        push_rewards: true,
        push_promos: true,
        email_monthly_statement: false,
        language: 'en-GB',
      });
      notificationsByUserId.set(user.id, []);
      rentPaymentsByUserId.set(user.id, []);
      rentReportsByUserId.set(user.id, []);
      assert.equal(termsVersion, '2026-04-28');
      assert.equal(privacyVersion, '2026-04-28');
      return this.getMe(user.id);
    },

    async findUserByEmail(email) {
      return usersByEmail.get(email.toLowerCase()) || null;
    },

    async recordLogin(userId) {
      assert.ok(usersById.has(userId));
    },

    async saveRefreshToken({ userId, tokenHash, expiresAt }) {
      assert.ok(usersById.has(userId));
      assert.ok(tokenHash);
      assert.ok(expiresAt instanceof Date);
    },

    async getMe(userId) {
      const user = usersById.get(userId);
      const profile = profilesByUserId.get(userId);
      const settings = settingsByUserId.get(userId);
      if (!user || !profile || !settings) return null;

      return {
        user: {
          id: user.id,
          name: profile.full_name,
          email: user.email,
          dob: profile.dob,
          nationality: profile.nationality,
          kyc_status: profile.kyc_status,
        },
        settings,
      };
    },

    async updateProfile(userId, updates) {
      const user = usersById.get(userId);
      const profile = profilesByUserId.get(userId);
      if (!user || !profile) return null;

      if (updates.email !== undefined) {
        const normalizedEmail = updates.email.toLowerCase();
        const existing = usersByEmail.get(normalizedEmail);
        if (existing && existing.id !== userId) {
          const error = new Error('email already registered');
          error.code = '23505';
          throw error;
        }
        usersByEmail.delete(user.email);
        user.email = normalizedEmail;
        usersByEmail.set(normalizedEmail, user);
      }
      if (updates.name !== undefined) profile.full_name = updates.name;
      if (updates.dob !== undefined) profile.dob = updates.dob;
      if (updates.nationality !== undefined) profile.nationality = updates.nationality;

      return this.getMe(userId);
    },

    async updateSettings(userId, updates) {
      const settings = settingsByUserId.get(userId);
      if (!settings) return null;
      Object.assign(settings, updates);
      return this.getMe(userId);
    },

    async listNotifications(userId, { limit }) {
      const notifications = notificationsByUserId.get(userId) || [];
      return notifications
        .slice()
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit)
        .map((notification) => ({
          id: notification.id,
          title: notification.title,
          body: notification.body,
          type: notification.type,
          icon: notification.icon,
          timestamp: notification.created_at,
          read: notification.read_at !== null,
        }));
    },

    async markNotificationRead(userId, notificationId) {
      const notification = (notificationsByUserId.get(userId) || []).find((item) => item.id === notificationId);
      if (!notification) return null;
      notification.read_at = '2026-04-28T05:32:00.000Z';
      return {
        id: notification.id,
        title: notification.title,
        body: notification.body,
        type: notification.type,
        icon: notification.icon,
        timestamp: notification.created_at,
        read: true,
      };
    },

    async markAllNotificationsRead(userId) {
      const notifications = notificationsByUserId.get(userId) || [];
      for (const notification of notifications) {
        notification.read_at = notification.read_at || '2026-04-28T05:32:00.000Z';
      }
      return notifications.length;
    },

    seedNotification(userId, notification) {
      notificationsByUserId.get(userId).push({
        read_at: null,
        ...notification,
      });
    },

    async upsertTenancy(userId, tenancy) {
      const row = {
        id: tenanciesByUserId.get(userId)?.id || `tenancy-${userId}`,
        user_id: userId,
        ...tenancy,
      };
      tenanciesByUserId.set(userId, row);

      const payments = Array.from({ length: 12 }, (_, index) => ({
        id: `payment-${index + 1}`,
        amount: tenancy.monthly_rent,
        due_date: `2026-${String(index + 5).padStart(2, '0')}-05`,
        paid_date: null,
        status: 'due',
      }));
      rentPaymentsByUserId.set(userId, payments);

      return row;
    },

    async getTenancy(userId) {
      return tenanciesByUserId.get(userId) || null;
    },

    async listRentPayments(userId) {
      return rentPaymentsByUserId.get(userId) || [];
    },

    async createManualRentReport(userId, report) {
      const tenancy = tenanciesByUserId.get(userId);
      if (!tenancy) return null;

      const rentReport = {
        id: `report-${rentReportsByUserId.get(userId).length + 1}`,
        status: 'pending',
        created_at: '2026-04-28T05:43:00.000Z',
        ...report,
      };
      rentReportsByUserId.get(userId).push(rentReport);
      return rentReport;
    },
  };
}

async function withServer(app, fn) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('register, login, and get current user profile', async () => {
  const app = createApp({
    accountStore: createMemoryAccountStore(),
    jwtSecret: 'test-secret',
  });

  await withServer(app, async (baseUrl) => {
    const registerResponse = await fetch(`${baseUrl}/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Alex Morgan',
        email: 'Alex@example.com',
        password: 'Password1',
        accept_terms: true,
        terms_version: '2026-04-28',
        privacy_version: '2026-04-28',
      }),
    });
    const registered = await registerResponse.json();

    assert.equal(registerResponse.status, 201);
    assert.equal(registered.data.token_type, 'Bearer');
    assert.equal(registered.data.user.user.email, 'alex@example.com');
    assert.equal(registered.data.user.user.name, 'Alex Morgan');
    assert.ok(registered.data.access_token);
    assert.ok(registered.data.refresh_token);

    const loginResponse = await fetch(`${baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'alex@example.com', password: 'Password1' }),
    });
    const loggedIn = await loginResponse.json();

    assert.equal(loginResponse.status, 200);
    assert.ok(loggedIn.data.access_token);

    const meResponse = await fetch(`${baseUrl}/v1/me`, {
      headers: { authorization: `Bearer ${loggedIn.data.access_token}` },
    });
    const me = await meResponse.json();

    assert.equal(meResponse.status, 200);
    assert.deepEqual(me.data.user, {
      id: 'user-1',
      name: 'Alex Morgan',
      email: 'alex@example.com',
      dob: null,
      nationality: '',
      kyc_status: 'pending',
    });
    assert.equal(me.data.settings.language, 'en-GB');
  });
});

test('patch profile and settings round trip through current user', async () => {
  const store = createMemoryAccountStore();
  const app = createApp({
    accountStore: store,
    jwtSecret: 'test-secret',
  });

  await withServer(app, async (baseUrl) => {
    const registerResponse = await fetch(`${baseUrl}/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Alex Morgan',
        email: 'alex@example.com',
        password: 'Password1',
        accept_terms: true,
        terms_version: '2026-04-28',
        privacy_version: '2026-04-28',
      }),
    });
    const registered = await registerResponse.json();
    const token = registered.data.access_token;

    const profileResponse = await fetch(`${baseUrl}/v1/me/profile`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Alexandra Morgan',
        email: 'alexandra@example.com',
        dob: '1991-02-03',
        nationality: 'British',
      }),
    });
    const profile = await profileResponse.json();

    assert.equal(profileResponse.status, 200);
    assert.deepEqual(profile.data.user, {
      id: 'user-1',
      name: 'Alexandra Morgan',
      email: 'alexandra@example.com',
      dob: '1991-02-03',
      nationality: 'British',
      kyc_status: 'pending',
    });

    const settingsResponse = await fetch(`${baseUrl}/v1/me/settings`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        push_rent_reminders: false,
        push_passport_updates: true,
        push_rewards: false,
        push_promos: false,
        email_monthly_statement: true,
        language: 'en-US',
      }),
    });
    const settings = await settingsResponse.json();

    assert.equal(settingsResponse.status, 200);
    assert.equal(settings.data.settings.push_rent_reminders, false);
    assert.equal(settings.data.settings.push_rewards, false);
    assert.equal(settings.data.settings.email_monthly_statement, true);
    assert.equal(settings.data.settings.language, 'en-US');
  });
});

test('list and mark notifications as read', async () => {
  const store = createMemoryAccountStore();
  const app = createApp({
    accountStore: store,
    jwtSecret: 'test-secret',
  });

  await withServer(app, async (baseUrl) => {
    const registerResponse = await fetch(`${baseUrl}/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Alex Morgan',
        email: 'alex@example.com',
        password: 'Password1',
        accept_terms: true,
        terms_version: '2026-04-28',
        privacy_version: '2026-04-28',
      }),
    });
    const registered = await registerResponse.json();
    const token = registered.data.access_token;

    store.seedNotification('user-1', {
      id: 'notification-1',
      title: 'Rent reminder',
      body: 'Your rent payment is due soon.',
      type: 'rent',
      icon: 'home',
      created_at: '2026-04-28T05:30:00.000Z',
    });

    const listResponse = await fetch(`${baseUrl}/v1/me/notifications`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const list = await listResponse.json();

    assert.equal(listResponse.status, 200);
    assert.deepEqual(list.data.notifications, [
      {
        id: 'notification-1',
        title: 'Rent reminder',
        body: 'Your rent payment is due soon.',
        type: 'rent',
        icon: 'home',
        timestamp: '2026-04-28T05:30:00.000Z',
        read: false,
      },
    ]);

    const readResponse = await fetch(`${baseUrl}/v1/me/notifications/notification-1/read`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    const read = await readResponse.json();

    assert.equal(readResponse.status, 200);
    assert.equal(read.data.notification.read, true);

    const readAllResponse = await fetch(`${baseUrl}/v1/me/notifications/read-all`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    const readAll = await readAllResponse.json();

    assert.equal(readAllResponse.status, 200);
    assert.equal(readAll.data.updated_count, 1);
  });
});

test('upsert tenancy generates rent payments and manual reports persist as pending', async () => {
  const store = createMemoryAccountStore();
  const app = createApp({
    accountStore: store,
    jwtSecret: 'test-secret',
    now: () => new Date('2026-04-28T05:43:00.000Z'),
  });

  await withServer(app, async (baseUrl) => {
    const registerResponse = await fetch(`${baseUrl}/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Alex Morgan',
        email: 'alex@example.com',
        password: 'Password1',
        accept_terms: true,
        terms_version: '2026-04-28',
        privacy_version: '2026-04-28',
      }),
    });
    const registered = await registerResponse.json();
    const token = registered.data.access_token;

    const tenancyResponse = await fetch(`${baseUrl}/v1/me/tenancy`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        property_address: 'Flat 4, 10 Grove Street, London',
        monthly_rent: 1450,
        payment_day: 5,
        landlord_name: 'Sam Landlord',
        agent_name: '',
        tenancy_end_date: '2027-04-30',
        landlord_email: 'landlord@example.com',
        landlord_phone: '+44 7700 900123',
      }),
    });
    const tenancy = await tenancyResponse.json();

    assert.equal(tenancyResponse.status, 200);
    assert.equal(tenancy.data.tenancy.property_address, 'Flat 4, 10 Grove Street, London');
    assert.equal(tenancy.data.tenancy.monthly_rent, 1450);
    assert.equal(tenancy.data.tenancy.payment_day, 5);

    const getTenancyResponse = await fetch(`${baseUrl}/v1/me/tenancy`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const fetchedTenancy = await getTenancyResponse.json();

    assert.equal(getTenancyResponse.status, 200);
    assert.equal(fetchedTenancy.data.tenancy.landlord_name, 'Sam Landlord');

    const paymentsResponse = await fetch(`${baseUrl}/v1/me/rent/payments`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const payments = await paymentsResponse.json();

    assert.equal(paymentsResponse.status, 200);
    assert.equal(payments.data.payments.length, 12);
    assert.deepEqual(payments.data.payments[0], {
      id: 'payment-1',
      amount: 1450,
      due_date: '2026-05-05',
      paid_date: null,
      status: 'due',
    });

    const reportResponse = await fetch(`${baseUrl}/v1/me/rent/reports/manual`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        amount: 1450,
        payment_date: '2026-04-27',
        payment_method: 'Bank transfer',
        reference: 'TXN-123',
        notes: 'April rent',
      }),
    });
    const report = await reportResponse.json();

    assert.equal(reportResponse.status, 201);
    assert.equal(report.data.report.id, 'report-1');
    assert.equal(report.data.report.status, 'pending');
    assert.equal(report.data.report.created_at, '2026-04-28T05:43:00.000Z');
  });
});

test('manual rent report rejects future payment dates', async () => {
  const app = createApp({
    accountStore: createMemoryAccountStore(),
    jwtSecret: 'test-secret',
    now: () => new Date('2026-04-28T05:43:00.000Z'),
  });

  await withServer(app, async (baseUrl) => {
    const registerResponse = await fetch(`${baseUrl}/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Alex Morgan',
        email: 'alex@example.com',
        password: 'Password1',
        accept_terms: true,
        terms_version: '2026-04-28',
        privacy_version: '2026-04-28',
      }),
    });
    const registered = await registerResponse.json();
    const token = registered.data.access_token;

    const reportResponse = await fetch(`${baseUrl}/v1/me/rent/reports/manual`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        amount: 1450,
        payment_date: '2026-04-29',
        payment_method: 'Bank transfer',
      }),
    });
    const report = await reportResponse.json();

    assert.equal(reportResponse.status, 400);
    assert.equal(report.error.code, 'invalid_payment_date');
  });
});
