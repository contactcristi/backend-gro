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

function mapNotificationRow(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    type: row.type,
    icon: row.icon,
    timestamp: row.created_at,
    read: row.read_at !== null,
  };
}

function buildUpdateSet(updates, mapping, startIndex = 1) {
  const assignments = [];
  const values = [];

  for (const [apiField, dbColumn] of Object.entries(mapping)) {
    if (updates[apiField] !== undefined) {
      values.push(updates[apiField]);
      assignments.push(`${dbColumn} = $${startIndex + values.length - 1}`);
    }
  }

  return { assignments, values };
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

    async updateProfile(userId, updates) {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        if (updates.email !== undefined) {
          await client.query(
            `UPDATE users
             SET email = $1
             WHERE id = $2`,
            [updates.email, userId],
          );
        }

        const { assignments, values } = buildUpdateSet(updates, {
          name: 'full_name',
          dob: 'dob',
          nationality: 'nationality',
        });

        if (assignments.length > 0) {
          values.push(userId);
          await client.query(
            `UPDATE user_profiles
             SET ${assignments.join(', ')}
             WHERE user_id = $${values.length}`,
            values,
          );
        }

        await client.query(
          `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata)
           VALUES ($1, 'profile.update', 'user_profile', $1, $2::jsonb)`,
          [userId, JSON.stringify({ fields: Object.keys(updates) })],
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

    async updateSettings(userId, updates) {
      const { assignments, values } = buildUpdateSet(updates, {
        push_rent_reminders: 'push_rent_reminders',
        push_passport_updates: 'push_passport_updates',
        push_rewards: 'push_rewards',
        push_promos: 'push_promos',
        email_monthly_statement: 'email_monthly_statement',
        language: 'language',
      });

      values.push(userId);
      const result = await pool.query(
        `UPDATE user_settings
         SET ${assignments.join(', ')}
         WHERE user_id = $${values.length}`,
        values,
      );

      if (result.rowCount === 0) return null;

      await pool.query(
        `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'settings.update', 'user_settings', $1, $2::jsonb)`,
        [userId, JSON.stringify({ fields: Object.keys(updates) })],
      );

      return this.getMe(userId);
    },

    async listNotifications(userId, { limit }) {
      const result = await pool.query(
        `SELECT
           id::text,
           title,
           body,
           type,
           icon,
           created_at,
           read_at
         FROM notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit],
      );
      return result.rows.map(mapNotificationRow);
    },

    async markNotificationRead(userId, notificationId) {
      const result = await pool.query(
        `UPDATE notifications
         SET read_at = COALESCE(read_at, now())
         WHERE user_id = $1 AND id = $2
         RETURNING id::text, title, body, type, icon, created_at, read_at`,
        [userId, notificationId],
      );
      return result.rows[0] ? mapNotificationRow(result.rows[0]) : null;
    },

    async markAllNotificationsRead(userId) {
      const result = await pool.query(
        `UPDATE notifications
         SET read_at = COALESCE(read_at, now())
         WHERE user_id = $1`,
        [userId],
      );
      return result.rowCount;
    },
  };
}

module.exports = {
  createPostgresAccountStore,
};
