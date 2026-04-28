function mapMeRow(row) {
  if (!row) return null;

  return {
    user: {
      id: row.id,
      name: row.full_name,
      email: row.email,
      dob: row.dob,
      nationality: row.nationality,
      kyc_status: row.kyc_status,
    },
    settings: {
      push_rent_reminders: row.push_rent_reminders,
      push_passport_updates: row.push_passport_updates,
      push_rewards: row.push_rewards,
      push_promos: row.push_promos,
      email_monthly_statement: row.email_monthly_statement,
      language: row.language,
    },
  };
}

function createPostgresAccountStore(pool) {
  return {
    async createRegisteredUser({ email, passwordHash, name, termsVersion, privacyVersion }) {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const userResult = await client.query(
          `INSERT INTO users (email, password_hash)
           VALUES ($1, $2)
           RETURNING id`,
          [email, passwordHash],
        );
        const userId = userResult.rows[0].id;

        await client.query(
          `INSERT INTO user_profiles (user_id, full_name)
           VALUES ($1, $2)`,
          [userId, name],
        );
        await client.query(
          `INSERT INTO user_settings (user_id)
           VALUES ($1)`,
          [userId],
        );
        await client.query(
          `INSERT INTO user_consents (user_id, terms_version, privacy_version)
           VALUES ($1, $2, $3)`,
          [userId, termsVersion, privacyVersion],
        );
        await client.query(
          `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata)
           VALUES ($1, 'user.register', 'user', $1, '{}'::jsonb)`,
          [userId],
        );

        await client.query('COMMIT');
        return this.getMe(userId);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async findUserByEmail(email) {
      const result = await pool.query(
        `SELECT id, email, password_hash
         FROM users
         WHERE email = $1`,
        [email],
      );
      return result.rows[0] || null;
    },

    async recordLogin(userId) {
      await pool.query(
        `UPDATE users
         SET last_login_at = now()
         WHERE id = $1`,
        [userId],
      );
      await pool.query(
        `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'user.login', 'user', $1, '{}'::jsonb)`,
        [userId],
      );
    },

    async saveRefreshToken({ userId, tokenHash, expiresAt, userAgent, ip }) {
      await pool.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip)
         VALUES ($1, $2, $3, $4, NULLIF($5, '')::inet)`,
        [userId, tokenHash, expiresAt, userAgent, ip],
      );
    },

    async getMe(userId) {
      const result = await pool.query(
        `SELECT
           u.id,
           u.email::text AS email,
           p.full_name,
           to_char(p.dob, 'YYYY-MM-DD') AS dob,
           p.nationality,
           p.kyc_status,
           s.push_rent_reminders,
           s.push_passport_updates,
           s.push_rewards,
           s.push_promos,
           s.email_monthly_statement,
           s.language
         FROM users u
         JOIN user_profiles p ON p.user_id = u.id
         JOIN user_settings s ON s.user_id = u.id
         WHERE u.id = $1`,
        [userId],
      );
      return mapMeRow(result.rows[0]);
    },
  };
}

module.exports = {
  createPostgresAccountStore,
};
