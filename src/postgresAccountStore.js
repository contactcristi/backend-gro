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

function mapTenancyRow(row) {
  return {
    id: row.id,
    property_address: row.property_address,
    monthly_rent: Number(row.monthly_rent_gbp),
    payment_day: row.payment_day,
    landlord_name: row.landlord_name,
    agent_name: row.agent_name,
    tenancy_end_date: row.tenancy_end_date,
    landlord_email: row.landlord_email,
    landlord_phone: row.landlord_phone,
  };
}

function mapRentPaymentRow(row) {
  return {
    id: row.id,
    amount: Number(row.amount_gbp),
    due_date: row.due_date,
    paid_date: row.paid_date,
    status: row.status,
  };
}

function mapRentReportRow(row) {
  return {
    id: row.id,
    amount: Number(row.amount_gbp),
    payment_date: row.payment_date,
    payment_method: row.payment_method,
    reference: row.reference,
    notes: row.notes,
    source: row.source,
    status: row.status,
    created_at: row.created_at,
  };
}

function addMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function dueDateForMonth(monthStart, paymentDay) {
  const year = monthStart.getUTCFullYear();
  const month = monthStart.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return formatDate(new Date(Date.UTC(year, month, Math.min(paymentDay, lastDay))));
}

function buildRentSchedule({ monthlyRent, paymentDay, tenancyEndDate, now }) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let firstMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  if (dueDateForMonth(firstMonth, paymentDay) < formatDate(today)) {
    firstMonth = addMonths(firstMonth, 1);
  }

  const payments = [];
  for (let i = 0; i < 12; i += 1) {
    const dueDate = dueDateForMonth(addMonths(firstMonth, i), paymentDay);
    if (dueDate > tenancyEndDate) break;
    payments.push({
      amount: monthlyRent,
      dueDate,
      status: 'due',
    });
  }
  return payments;
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

    async upsertTenancy(userId, tenancy, { now }) {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const tenancyResult = await client.query(
          `INSERT INTO tenancies (
             user_id,
             property_address,
             monthly_rent_gbp,
             payment_day,
             landlord_name,
             agent_name,
             tenancy_end_date,
             landlord_email,
             landlord_phone
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (user_id) DO UPDATE
           SET
             property_address = EXCLUDED.property_address,
             monthly_rent_gbp = EXCLUDED.monthly_rent_gbp,
             payment_day = EXCLUDED.payment_day,
             landlord_name = EXCLUDED.landlord_name,
             agent_name = EXCLUDED.agent_name,
             tenancy_end_date = EXCLUDED.tenancy_end_date,
             landlord_email = EXCLUDED.landlord_email,
             landlord_phone = EXCLUDED.landlord_phone
           RETURNING
             id::text,
             property_address,
             monthly_rent_gbp,
             payment_day,
             landlord_name,
             agent_name,
             to_char(tenancy_end_date, 'YYYY-MM-DD') AS tenancy_end_date,
             landlord_email,
             landlord_phone`,
          [
            userId,
            tenancy.property_address,
            tenancy.monthly_rent,
            tenancy.payment_day,
            tenancy.landlord_name,
            tenancy.agent_name,
            tenancy.tenancy_end_date,
            tenancy.landlord_email,
            tenancy.landlord_phone,
          ],
        );
        const savedTenancy = tenancyResult.rows[0];
        const schedule = buildRentSchedule({
          monthlyRent: tenancy.monthly_rent,
          paymentDay: tenancy.payment_day,
          tenancyEndDate: tenancy.tenancy_end_date,
          now,
        });

        for (const payment of schedule) {
          await client.query(
            `INSERT INTO rent_payments (user_id, tenancy_id, amount_gbp, due_date, status)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (tenancy_id, due_date) DO UPDATE
             SET amount_gbp = EXCLUDED.amount_gbp`,
            [userId, savedTenancy.id, payment.amount, payment.dueDate, payment.status],
          );
        }

        await client.query(
          `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata)
           VALUES ($1, 'tenancy.update', 'tenancy', $2, '{}'::jsonb)`,
          [userId, savedTenancy.id],
        );

        await client.query('COMMIT');
        return mapTenancyRow(savedTenancy);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async getTenancy(userId) {
      const result = await pool.query(
        `SELECT
           id::text,
           property_address,
           monthly_rent_gbp,
           payment_day,
           landlord_name,
           agent_name,
           to_char(tenancy_end_date, 'YYYY-MM-DD') AS tenancy_end_date,
           landlord_email,
           landlord_phone
         FROM tenancies
         WHERE user_id = $1`,
        [userId],
      );
      return result.rows[0] ? mapTenancyRow(result.rows[0]) : null;
    },

    async listRentPayments(userId) {
      const result = await pool.query(
        `SELECT
           id::text,
           amount_gbp,
           to_char(due_date, 'YYYY-MM-DD') AS due_date,
           to_char(paid_date, 'YYYY-MM-DD') AS paid_date,
           status
         FROM rent_payments
         WHERE user_id = $1
         ORDER BY due_date ASC`,
        [userId],
      );
      return result.rows.map(mapRentPaymentRow);
    },

    async createManualRentReport(userId, report) {
      const tenancy = await this.getTenancy(userId);
      if (!tenancy) return null;

      const result = await pool.query(
        `INSERT INTO rent_reports (
           user_id,
           tenancy_id,
           amount_gbp,
           payment_date,
           payment_method,
           reference,
           notes,
           source,
           status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual', 'pending')
         RETURNING
           id::text,
           amount_gbp,
           to_char(payment_date, 'YYYY-MM-DD') AS payment_date,
           payment_method,
           reference,
           notes,
           source,
           status,
           created_at`,
        [
          userId,
          tenancy.id,
          report.amount,
          report.payment_date,
          report.payment_method,
          report.reference,
          report.notes,
        ],
      );

      await pool.query(
        `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'rent_report.create', 'rent_report', $2, '{}'::jsonb)`,
        [userId, result.rows[0].id],
      );

      return mapRentReportRow(result.rows[0]);
    },
  };
}

module.exports = {
  buildRentSchedule,
  createPostgresAccountStore,
};
