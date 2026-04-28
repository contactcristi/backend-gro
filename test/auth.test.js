const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../src/app');

function createMemoryAccountStore() {
  const usersByEmail = new Map();
  const usersById = new Map();
  const profilesByUserId = new Map();
  const settingsByUserId = new Map();

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
