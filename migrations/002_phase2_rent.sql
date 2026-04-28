CREATE TABLE IF NOT EXISTS tenancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  property_address text NOT NULL,
  monthly_rent_gbp numeric(12, 2) NOT NULL,
  payment_day smallint NOT NULL,
  landlord_name text NOT NULL,
  agent_name text NOT NULL DEFAULT '',
  tenancy_end_date date NOT NULL,
  landlord_email text NULL,
  landlord_phone text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT monthly_rent_positive_check CHECK (monthly_rent_gbp > 0),
  CONSTRAINT payment_day_check CHECK (payment_day BETWEEN 1 AND 31)
);

DROP TRIGGER IF EXISTS tenancies_set_updated_at ON tenancies;
CREATE TRIGGER tenancies_set_updated_at
BEFORE UPDATE ON tenancies
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS rent_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenancy_id uuid NOT NULL REFERENCES tenancies(id) ON DELETE CASCADE,
  amount_gbp numeric(12, 2) NOT NULL,
  due_date date NOT NULL,
  paid_date date NULL,
  status text NOT NULL DEFAULT 'due',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_payment_amount_positive_check CHECK (amount_gbp > 0),
  CONSTRAINT rent_payment_status_check CHECK (status IN ('paid', 'due', 'overdue')),
  UNIQUE (tenancy_id, due_date)
);

CREATE INDEX IF NOT EXISTS rent_payments_user_due_date_idx
ON rent_payments(user_id, due_date);

CREATE TABLE IF NOT EXISTS rent_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenancy_id uuid NOT NULL REFERENCES tenancies(id) ON DELETE CASCADE,
  amount_gbp numeric(12, 2) NOT NULL,
  payment_date date NOT NULL,
  payment_method text NOT NULL,
  reference text NULL,
  notes text NULL,
  source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz NULL,
  verified_by text NULL,
  CONSTRAINT rent_report_amount_positive_check CHECK (amount_gbp > 0 AND amount_gbp <= 50000),
  CONSTRAINT rent_report_payment_method_check CHECK (
    payment_method IN ('Bank transfer', 'Standing order', 'Direct debit', 'Cash', 'Other')
  ),
  CONSTRAINT rent_report_source_check CHECK (source IN ('manual')),
  CONSTRAINT rent_report_status_check CHECK (status IN ('pending', 'verified', 'rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS rent_report_duplicate_idx
ON rent_reports(user_id, amount_gbp, payment_date, source, COALESCE(reference, ''));

CREATE INDEX IF NOT EXISTS rent_reports_user_created_at_idx
ON rent_reports(user_id, created_at DESC);
