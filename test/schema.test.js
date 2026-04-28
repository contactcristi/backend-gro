const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migrationPath = path.join(__dirname, '..', 'migrations', '001_phase0_phase1.sql');
const phase2MigrationPath = path.join(__dirname, '..', 'migrations', '002_phase2_rent.sql');

test('phase 0 and phase 1 migration defines required account tables', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  for (const tableName of [
    'users',
    'user_profiles',
    'user_consents',
    'refresh_tokens',
    'audit_log',
    'user_settings',
    'notifications',
  ]) {
    assert.match(sql, new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+${tableName}`, 'i'));
  }

  assert.match(sql, /email\s+citext\s+unique\s+not\s+null/i);
  assert.match(sql, /password_hash\s+text\s+not\s+null/i);
  assert.match(sql, /kyc_status_check/i);
  assert.match(sql, /language_check/i);
});

test('phase 2 migration defines tenancy, rent payment, and report tables', () => {
  const sql = fs.readFileSync(phase2MigrationPath, 'utf8');

  for (const tableName of [
    'tenancies',
    'rent_payments',
    'rent_reports',
  ]) {
    assert.match(sql, new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+${tableName}`, 'i'));
  }

  assert.match(sql, /monthly_rent_gbp\s+numeric\(12,\s*2\)\s+not\s+null/i);
  assert.match(sql, /payment_day_check/i);
  assert.match(sql, /rent_payment_status_check/i);
  assert.match(sql, /rent_report_payment_method_check/i);
  assert.match(sql, /rent_report_duplicate_idx/i);
});
