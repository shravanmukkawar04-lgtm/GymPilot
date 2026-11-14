-- GymPilot schema. Safe to run repeatedly.

CREATE OR REPLACE FUNCTION gym_today() RETURNS date LANGUAGE sql STABLE AS
$$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

CREATE TABLE IF NOT EXISTS settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  gym_name text NOT NULL DEFAULT 'My Gym',
  address text, phone text, email text,
  gstin text,
  gst_enabled boolean NOT NULL DEFAULT true,
  default_gst_rate numeric(5,2) NOT NULL DEFAULT 18,
  prices_include_gst boolean NOT NULL DEFAULT true,
  sac_code text NOT NULL DEFAULT '999723',
  upi_id text,
  invoice_prefix text NOT NULL DEFAULT 'INV',
  invoice_terms text,
  weekly_off int DEFAULT 0,          -- 0 = Sunday ... 6 = Saturday, NULL = none
  inactive_days int NOT NULL DEFAULT 14,
  auto_expiry boolean NOT NULL DEFAULT true,
  auto_dues boolean NOT NULL DEFAULT true,
  auto_birthday boolean NOT NULL DEFAULT true
);
-- Each gym gets its own settings row from gym_defaults() near the end of this file.

CREATE TABLE IF NOT EXISTS staff (
  id serial PRIMARY KEY,
  name text NOT NULL,
  phone text, email text,
  role_title text NOT NULL DEFAULT 'Trainer',
  is_trainer boolean NOT NULL DEFAULT true,
  specialization text, certifications text,
  experience_years numeric(4,1),
  joined_on date NOT NULL DEFAULT gym_today(),
  base_salary numeric(12,2) NOT NULL DEFAULT 0,
  paid_leaves int NOT NULL DEFAULT 0,
  pt_commission_pct numeric(5,2) NOT NULL DEFAULT 0,
  bank_details text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'trainer',
  staff_id int UNIQUE REFERENCES staff(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id serial PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL,
  email text, gender text,
  source text, interest text,
  status text NOT NULL DEFAULT 'new',  -- new, contacted, trial, follow_up, won, lost
  assigned_to int REFERENCES staff(id) ON DELETE SET NULL,
  next_followup date,
  trial_start date, trial_end date,
  lost_reason text, notes text,
  converted_member_id int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_status_idx ON leads(status);
CREATE INDEX IF NOT EXISTS leads_followup_idx ON leads(next_followup);

CREATE TABLE IF NOT EXISTS lead_activities (
  id serial PRIMARY KEY,
  lead_id int NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'note',
  note text,
  created_by int REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS member_code_seq;

CREATE TABLE IF NOT EXISTS members (
  id serial PRIMARY KEY,
  member_code text NOT NULL UNIQUE DEFAULT 'M' || lpad(nextval('member_code_seq')::text, 4, '0'),
  name text NOT NULL,
  phone text NOT NULL,
  email text, gender text, dob date, address text,
  emergency_name text, emergency_phone text,
  health_notes text, goal text, notes text,
  joined_on date NOT NULL DEFAULT gym_today(),
  archived boolean NOT NULL DEFAULT false,
  lead_id int REFERENCES leads(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS members_phone_idx ON members(phone);

CREATE TABLE IF NOT EXISTS plans (
  id serial PRIMARY KEY,
  name text NOT NULL,
  duration_months int NOT NULL DEFAULT 1,
  duration_days int NOT NULL DEFAULT 0,
  price numeric(12,2) NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_counters (fy text PRIMARY KEY, last_no int NOT NULL);

CREATE TABLE IF NOT EXISTS invoices (
  id serial PRIMARY KEY,
  invoice_no text NOT NULL UNIQUE,
  member_id int REFERENCES members(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  customer_phone text,
  invoice_date date NOT NULL DEFAULT gym_today(),
  due_date date,
  gross numeric(12,2) NOT NULL DEFAULT 0,
  discount numeric(12,2) NOT NULL DEFAULT 0,
  taxable numeric(12,2) NOT NULL DEFAULT 0,
  cgst numeric(12,2) NOT NULL DEFAULT 0,
  sgst numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  paid numeric(12,2) NOT NULL DEFAULT 0,
  balance numeric(12,2) GENERATED ALWAYS AS (total - paid) STORED,
  status text NOT NULL DEFAULT 'unpaid',  -- unpaid, partial, paid, cancelled
  notes text,
  cancel_reason text,
  created_by int REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_member_idx ON invoices(member_id);
CREATE INDEX IF NOT EXISTS invoices_date_idx ON invoices(invoice_date);

CREATE TABLE IF NOT EXISTS invoice_items (
  id serial PRIMARY KEY,
  invoice_id int NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_type text NOT NULL DEFAULT 'other',  -- membership, pt, product, other
  ref_id int,
  description text NOT NULL,
  sac_hsn text,
  qty numeric(10,2) NOT NULL DEFAULT 1,
  rate numeric(12,2) NOT NULL DEFAULT 0,
  discount numeric(12,2) NOT NULL DEFAULT 0,
  taxable numeric(12,2) NOT NULL DEFAULT 0,
  gst_rate numeric(5,2) NOT NULL DEFAULT 0,
  cgst numeric(12,2) NOT NULL DEFAULT 0,
  sgst numeric(12,2) NOT NULL DEFAULT 0,
  amount numeric(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx ON invoice_items(invoice_id);

CREATE TABLE IF NOT EXISTS payments (
  id serial PRIMARY KEY,
  invoice_id int NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL DEFAULT 'cash',  -- cash, upi, card, bank
  reference text,
  paid_on date NOT NULL DEFAULT gym_today(),
  voided boolean NOT NULL DEFAULT false,
  received_by int REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS payments_date_idx ON payments(paid_on);

CREATE TABLE IF NOT EXISTS memberships (
  id serial PRIMARY KEY,
  member_id int NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  plan_id int REFERENCES plans(id) ON DELETE SET NULL,
  plan_name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  price numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',  -- active, cancelled
  invoice_id int REFERENCES invoices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memberships_member_idx ON memberships(member_id, end_date DESC);

CREATE TABLE IF NOT EXISTS membership_freezes (
  id serial PRIMARY KEY,
  membership_id int NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pt_packages (
  id serial PRIMARY KEY,
  name text NOT NULL,
  sessions int NOT NULL CHECK (sessions > 0),
  validity_days int NOT NULL DEFAULT 30,
  price numeric(12,2) NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS pt_subscriptions (
  id serial PRIMARY KEY,
  member_id int NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  trainer_id int NOT NULL REFERENCES staff(id),
  package_id int REFERENCES pt_packages(id) ON DELETE SET NULL,
  package_name text NOT NULL,
  total_sessions int NOT NULL,
  used_sessions int NOT NULL DEFAULT 0,
  start_date date NOT NULL,
  end_date date NOT NULL,
  price numeric(12,2) NOT NULL DEFAULT 0,
  commission_pct numeric(5,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',  -- active, completed, cancelled
  invoice_id int REFERENCES invoices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pt_subs_trainer_idx ON pt_subscriptions(trainer_id, status);

CREATE TABLE IF NOT EXISTS pt_sessions (
  id serial PRIMARY KEY,
  subscription_id int NOT NULL REFERENCES pt_subscriptions(id) ON DELETE CASCADE,
  trainer_id int NOT NULL REFERENCES staff(id),
  scheduled_at timestamptz NOT NULL,
  duration_min int NOT NULL DEFAULT 60,
  status text NOT NULL DEFAULT 'scheduled',  -- scheduled, completed, no_show, cancelled
  notes text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pt_sessions_time_idx ON pt_sessions(scheduled_at);

CREATE TABLE IF NOT EXISTS products (
  id serial PRIMARY KEY,
  sku text UNIQUE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Supplements',
  unit text NOT NULL DEFAULT 'pcs',
  hsn text,
  cost_price numeric(12,2) NOT NULL DEFAULT 0,
  sale_price numeric(12,2) NOT NULL DEFAULT 0,
  gst_rate numeric(5,2) NOT NULL DEFAULT 18,
  stock int NOT NULL DEFAULT 0,
  reorder_level int NOT NULL DEFAULT 5,
  supplier text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id serial PRIMARY KEY,
  product_id int NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type text NOT NULL,  -- purchase, sale, adjustment, damage, return
  qty int NOT NULL,
  unit_cost numeric(12,2),
  note text,
  invoice_id int REFERENCES invoices(id) ON DELETE SET NULL,
  created_by int REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS biometric_devices (
  id serial PRIMARY KEY,
  name text NOT NULL,
  serial_number text NOT NULL UNIQUE,
  api_key text NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
  location text,
  active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One device user number maps to exactly one person, across members and staff.
CREATE TABLE IF NOT EXISTS biometric_enrollments (
  device_user_id text PRIMARY KEY,
  member_id int UNIQUE REFERENCES members(id) ON DELETE CASCADE,
  staff_id int UNIQUE REFERENCES staff(id) ON DELETE CASCADE,
  CHECK ((member_id IS NULL) <> (staff_id IS NULL))
);

CREATE TABLE IF NOT EXISTS biometric_punches (
  id bigserial PRIMARY KEY,
  device_id int REFERENCES biometric_devices(id) ON DELETE SET NULL,
  device_user_id text NOT NULL,
  punched_at timestamptz NOT NULL,
  verify_type text,
  result text NOT NULL DEFAULT 'unknown',  -- in, out, ignored, unknown
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, device_user_id, punched_at)
);
CREATE INDEX IF NOT EXISTS punches_result_idx ON biometric_punches(result);

CREATE TABLE IF NOT EXISTS attendance (
  id bigserial PRIMARY KEY,
  member_id int REFERENCES members(id) ON DELETE CASCADE,
  staff_id int REFERENCES staff(id) ON DELETE CASCADE,
  day date NOT NULL,
  check_in timestamptz NOT NULL,
  check_out timestamptz,
  source text NOT NULL DEFAULT 'biometric',  -- biometric, manual
  membership_ok boolean NOT NULL DEFAULT true,
  CHECK ((member_id IS NULL) <> (staff_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_member_day ON attendance(member_id, day) WHERE member_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_staff_day ON attendance(staff_id, day) WHERE staff_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS attendance_day_idx ON attendance(day);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id serial PRIMARY KEY,
  month date NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payroll_items (
  id serial PRIMARY KEY,
  run_id int NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  staff_id int NOT NULL REFERENCES staff(id),
  base_salary numeric(12,2) NOT NULL DEFAULT 0,
  working_days numeric(5,1) NOT NULL DEFAULT 0,
  present_days numeric(5,1) NOT NULL DEFAULT 0,
  paid_leaves numeric(5,1) NOT NULL DEFAULT 0,
  absent_days numeric(5,1) NOT NULL DEFAULT 0,
  absence_deduction numeric(12,2) NOT NULL DEFAULT 0,
  commission numeric(12,2) NOT NULL DEFAULT 0,
  bonus numeric(12,2) NOT NULL DEFAULT 0,
  advance_deduction numeric(12,2) NOT NULL DEFAULT 0,
  other_deduction numeric(12,2) NOT NULL DEFAULT 0,
  net_pay numeric(12,2) NOT NULL DEFAULT 0,
  attendance_assumed boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',  -- pending, paid
  paid_on date,
  method text,
  UNIQUE (run_id, staff_id)
);

CREATE TABLE IF NOT EXISTS salary_advances (
  id serial PRIMARY KEY,
  staff_id int NOT NULL REFERENCES staff(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  given_on date NOT NULL DEFAULT gym_today(),
  note text,
  recovered_item_id int REFERENCES payroll_items(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id serial PRIMARY KEY,
  expense_date date NOT NULL DEFAULT gym_today(),
  category text NOT NULL,
  description text,
  vendor text,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL DEFAULT 'cash',
  reference text,
  created_by int REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses(expense_date);

CREATE TABLE IF NOT EXISTS message_templates (
  id serial PRIMARY KEY,
  key text UNIQUE,
  name text NOT NULL,
  subject text,
  body text NOT NULL,
  wa_template_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Built-in templates are added per gym by gym_defaults().

CREATE TABLE IF NOT EXISTS messages (
  id bigserial PRIMARY KEY,
  member_id int REFERENCES members(id) ON DELETE CASCADE,
  lead_id int REFERENCES leads(id) ON DELETE CASCADE,
  to_name text NOT NULL,
  phone text, email text,
  channel text NOT NULL DEFAULT 'whatsapp',  -- whatsapp, sms, email
  template_id int REFERENCES message_templates(id) ON DELETE SET NULL,
  subject text,
  body text NOT NULL,
  params jsonb,
  status text NOT NULL DEFAULT 'queued',  -- queued, sent, failed
  error text,
  origin text NOT NULL DEFAULT 'manual',  -- manual, automatic
  dedupe_key text UNIQUE,
  sent_at timestamptz,
  created_by int REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_status_idx ON messages(status);

-- Commands waiting for a fingerprint machine to collect.
CREATE TABLE IF NOT EXISTS device_commands (
  id bigserial PRIMARY KEY,
  device_id int NOT NULL REFERENCES biometric_devices(id) ON DELETE CASCADE,
  command text NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'pending',  -- pending, sent, done, failed
  return_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  done_at timestamptz
);
CREATE INDEX IF NOT EXISTS device_commands_idx ON device_commands(device_id, status);

CREATE TABLE IF NOT EXISTS whatsapp_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  phone_number_id text,
  waba_id text,
  access_token_enc text,
  app_secret_enc text,
  verify_token text NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
  display_phone text,
  verified_name text,
  quality_rating text,
  connected_at timestamptz
);

ALTER TABLE members ADD COLUMN IF NOT EXISTS whatsapp_opt_out boolean NOT NULL DEFAULT false;

ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'UTILITY',  -- UTILITY, MARKETING
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS header text,
  ADD COLUMN IF NOT EXISTS footer text,
  ADD COLUMN IF NOT EXISTS wa_template_id text,
  ADD COLUMN IF NOT EXISTS wa_status text,  -- PENDING, APPROVED, REJECTED, PAUSED, DISABLED
  ADD COLUMN IF NOT EXISTS wa_rejected_reason text;

UPDATE message_templates SET category='MARKETING'
  WHERE key IN ('birthday','welcome','inactive','lead_followup') AND wa_template_id IS NULL AND category='UTILITY';

CREATE TABLE IF NOT EXISTS campaigns (
  id serial PRIMARY KEY,
  name text NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  audience text,
  template_id int REFERENCES message_templates(id) ON DELETE SET NULL,
  mode text NOT NULL DEFAULT 'manual',  -- automatic, manual
  created_by int REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS campaign_id int REFERENCES campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wa_message_id text,
  ADD COLUMN IF NOT EXISTS delivery_status text,  -- sent, delivered, read, failed
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
CREATE INDEX IF NOT EXISTS messages_wa_idx ON messages(wa_message_id);
CREATE INDEX IF NOT EXISTS messages_campaign_idx ON messages(campaign_id, status);

CREATE OR REPLACE FUNCTION membership_valid(p_member int, p_day date) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships ms
    WHERE ms.member_id = p_member AND ms.status = 'active'
      AND p_day BETWEEN ms.start_date AND ms.end_date
      AND NOT EXISTS (SELECT 1 FROM membership_freezes f WHERE f.membership_id = ms.id AND p_day BETWEEN f.start_date AND f.end_date)
  )
$$;

/* =====================================================================
   Many gyms on one site (SaaS)

   Every row belongs to a gym, and most rows also belong to a branch.
   The app runs each request as the role gympilot_tenant with the gym and
   branch set for that request only, and the row-level security policies
   below hide every other gym's rows. A bug in one screen therefore cannot
   show one gym's data to another. Scripts and the super admin connect as
   the table owner, which is not limited by these policies.
   ===================================================================== */

DROP VIEW IF EXISTS member_overview;

CREATE TABLE IF NOT EXISTS gyms (
  id serial PRIMARY KEY,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS branches (
  id serial PRIMARY KEY,
  gym_id int NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text, phone text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The gym and branch of the current request. Empty branch = all branches of the gym.
CREATE OR REPLACE FUNCTION app_gym() RETURNS int LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.gym_id', true), '')::int $$;
CREATE OR REPLACE FUNCTION app_branch() RETURNS int LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.branch_id', true), '')::int $$;

CREATE TABLE IF NOT EXISTS slots (
  id serial PRIMARY KEY,
  name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS photos (
  id serial PRIMARY KEY,
  kind text NOT NULL,  -- member, user, gym
  ref_id int NOT NULL,
  mime text NOT NULL,
  data bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gym_counters (
  name text NOT NULL,
  last_no int NOT NULL DEFAULT 0
);

-- New columns for this release
ALTER TABLE members ADD COLUMN IF NOT EXISTS occupation text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS migrated boolean NOT NULL DEFAULT false;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS slot_ids int[] NOT NULL DEFAULT '{}';
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS slot_id int REFERENCES slots(id) ON DELETE SET NULL;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS slot_name text;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_welcome boolean NOT NULL DEFAULT true;

-- Tables that belong to a gym as a whole, and tables that belong to one branch.
CREATE OR REPLACE FUNCTION gp_gym_tables() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY[
  'settings','whatsapp_settings','message_templates','invoice_counters','gym_counters','photos','users','branches'] $$;
CREATE OR REPLACE FUNCTION gp_branch_tables() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY[
  'staff','leads','lead_activities','members','plans','slots','invoices','invoice_items','payments','memberships','membership_freezes',
  'pt_packages','pt_subscriptions','pt_sessions','products','stock_movements','biometric_devices','biometric_enrollments',
  'biometric_punches','attendance','payroll_runs','payroll_items','salary_advances','expenses','messages','campaigns','device_commands'] $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY gp_gym_tables() || gp_branch_tables() LOOP
    CONTINUE WHEN t = 'branches';
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS gym_id int REFERENCES gyms(id) ON DELETE CASCADE', t);
  END LOOP;
  FOREACH t IN ARRAY gp_branch_tables() || ARRAY['users'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS branch_id int REFERENCES branches(id) ON DELETE CASCADE', t);
  END LOOP;
END $$;

-- An install from before multi-gym support becomes gym 1 with one branch, keeping all its data.
INSERT INTO gyms (id) SELECT 1 WHERE EXISTS (SELECT 1 FROM settings WHERE gym_id IS NULL) AND NOT EXISTS (SELECT 1 FROM gyms WHERE id = 1);
INSERT INTO branches (id, gym_id, name) SELECT 1, 1, 'Main branch'
  WHERE EXISTS (SELECT 1 FROM gyms WHERE id = 1) AND NOT EXISTS (SELECT 1 FROM branches WHERE gym_id = 1);
SELECT setval(pg_get_serial_sequence('gyms', 'id'), GREATEST(COALESCE((SELECT max(id) FROM gyms), 0), 1), EXISTS (SELECT 1 FROM gyms));
SELECT setval(pg_get_serial_sequence('branches', 'id'), GREATEST(COALESCE((SELECT max(id) FROM branches), 0), 1), EXISTS (SELECT 1 FROM branches));

DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM gyms WHERE id = 1) THEN
    FOREACH t IN ARRAY gp_gym_tables() || gp_branch_tables() LOOP
      CONTINUE WHEN t = 'branches';
      EXECUTE format('UPDATE %I SET gym_id = 1 WHERE gym_id IS NULL', t);
    END LOOP;
    FOREACH t IN ARRAY gp_branch_tables() LOOP
      EXECUTE format('UPDATE %I SET branch_id = 1 WHERE branch_id IS NULL', t);
    END LOOP;
    UPDATE users u SET branch_id = s.branch_id FROM staff s WHERE s.id = u.staff_id AND u.branch_id IS NULL;
  END IF;
  FOREACH t IN ARRAY gp_gym_tables() || gp_branch_tables() LOOP
    CONTINUE WHEN t = 'branches';
    EXECUTE format('ALTER TABLE %I ALTER COLUMN gym_id SET NOT NULL, ALTER COLUMN gym_id SET DEFAULT app_gym()', t);
  END LOOP;
  FOREACH t IN ARRAY gp_branch_tables() LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN branch_id SET NOT NULL', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (branch_id)', t || '_branch_idx', t);
  END LOOP;
END $$;

-- One settings row per gym, keyed by the gym's id.
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_id_check;
ALTER TABLE settings ALTER COLUMN id SET DEFAULT app_gym();
ALTER TABLE whatsapp_settings DROP CONSTRAINT IF EXISTS whatsapp_settings_id_check;
ALTER TABLE whatsapp_settings ALTER COLUMN id SET DEFAULT app_gym();
CREATE UNIQUE INDEX IF NOT EXISTS settings_gym ON settings (gym_id);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_settings_gym ON whatsapp_settings (gym_id);

-- Values that were unique for the whole site are now unique per gym or per branch.
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_member_code_key;
ALTER TABLE members ALTER COLUMN member_code DROP DEFAULT;
CREATE UNIQUE INDEX IF NOT EXISTS members_gym_code ON members (gym_id, member_code);
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_no_key;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_gym_no ON invoices (gym_id, invoice_no);
ALTER TABLE invoice_counters DROP CONSTRAINT IF EXISTS invoice_counters_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS invoice_counters_gym_fy ON invoice_counters (gym_id, fy);
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key;
CREATE UNIQUE INDEX IF NOT EXISTS products_gym_sku ON products (gym_id, sku);
ALTER TABLE message_templates DROP CONSTRAINT IF EXISTS message_templates_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS message_templates_gym_key ON message_templates (gym_id, key);
ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_month_key;
CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_branch_month ON payroll_runs (branch_id, month);
ALTER TABLE biometric_enrollments DROP CONSTRAINT IF EXISTS biometric_enrollments_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS biometric_enrollments_branch_pin ON biometric_enrollments (branch_id, device_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS gym_counters_key ON gym_counters (gym_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS photos_ref ON photos (gym_id, kind, ref_id);
CREATE INDEX IF NOT EXISTS branches_gym_idx ON branches (gym_id);
CREATE INDEX IF NOT EXISTS users_gym_idx ON users (gym_id);
CREATE INDEX IF NOT EXISTS whatsapp_settings_phone_idx ON whatsapp_settings (phone_number_id);

-- Member numbers count up separately for each gym: M0001, M0002, ...
INSERT INTO gym_counters (gym_id, name, last_no)
  SELECT 1, 'member', (SELECT COALESCE(max(substring(member_code FROM '^M(\d+)$')::int), 0) FROM members WHERE gym_id = 1)
  WHERE EXISTS (SELECT 1 FROM gyms WHERE id = 1)
ON CONFLICT (gym_id, name) DO NOTHING;

CREATE OR REPLACE FUNCTION next_member_code() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int; code text;
BEGIN
  IF NEW.member_code IS NOT NULL AND btrim(NEW.member_code) <> '' THEN
    NEW.member_code := btrim(NEW.member_code);
    RETURN NEW;
  END IF;
  LOOP  -- skips numbers already taken by members imported with their old codes
    INSERT INTO gym_counters (gym_id, name, last_no) VALUES (NEW.gym_id, 'member', 1)
      ON CONFLICT (gym_id, name) DO UPDATE SET last_no = gym_counters.last_no + 1 RETURNING last_no INTO n;
    code := 'M' || lpad(n::text, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM members WHERE gym_id = NEW.gym_id AND member_code = code);
  END LOOP;
  NEW.member_code := code;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS members_code ON members;
CREATE TRIGGER members_code BEFORE INSERT ON members FOR EACH ROW EXECUTE FUNCTION next_member_code();

/* A new row takes its branch from the record it belongs to (a payment from its bill,
   a bill from its member, and so on), otherwise from the branch chosen on screen.
   Arguments are pairs of (parent table, column holding the parent id). */
CREATE OR REPLACE FUNCTION fill_branch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i int; pid int; b int;
BEGIN
  IF NEW.branch_id IS NULL THEN
    FOR i IN 0 .. (TG_NARGS / 2) - 1 LOOP
      pid := (to_jsonb(NEW) ->> TG_ARGV[i * 2 + 1])::int;
      CONTINUE WHEN pid IS NULL;
      EXECUTE format('SELECT branch_id FROM %I WHERE id = $1', TG_ARGV[i * 2]) INTO b USING pid;
      IF b IS NOT NULL THEN NEW.branch_id := b; EXIT; END IF;
    END LOOP;
  END IF;
  NEW.branch_id := COALESCE(NEW.branch_id, app_branch());
  IF NEW.branch_id IS NULL THEN
    RAISE EXCEPTION 'Choose a branch at the top of the screen first. In "All branches" you can look at everything, but new records need a branch.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('staff', ''), ('leads', ''), ('lead_activities', 'leads,lead_id'), ('members', 'leads,lead_id'), ('plans', ''), ('slots', ''),
    ('invoices', 'members,member_id'), ('invoice_items', 'invoices,invoice_id'), ('payments', 'invoices,invoice_id'),
    ('memberships', 'members,member_id'), ('membership_freezes', 'memberships,membership_id'), ('pt_packages', ''),
    ('pt_subscriptions', 'members,member_id'), ('pt_sessions', 'pt_subscriptions,subscription_id'), ('products', ''),
    ('stock_movements', 'products,product_id'), ('biometric_devices', ''), ('biometric_enrollments', 'members,member_id,staff,staff_id'),
    ('biometric_punches', 'biometric_devices,device_id'), ('attendance', 'members,member_id,staff,staff_id'), ('payroll_runs', ''),
    ('payroll_items', 'payroll_runs,run_id'), ('salary_advances', 'staff,staff_id'), ('expenses', ''),
    ('messages', 'members,member_id,leads,lead_id,campaigns,campaign_id'), ('campaigns', ''), ('device_commands', 'biometric_devices,device_id')
  ) AS x(tbl, parents) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS a_fill_branch ON %I', r.tbl);
    EXECUTE format('CREATE TRIGGER a_fill_branch BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION fill_branch(%s)', r.tbl,
      COALESCE((SELECT string_agg(quote_literal(p), ',') FROM unnest(string_to_array(nullif(r.parents, ''), ',')) p), ''));
  END LOOP;
END $$;

-- Row-level security: each request only sees its own gym, and its own branch when one is chosen.
CREATE OR REPLACE FUNCTION branch_in_gym(b int) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT EXISTS (SELECT 1 FROM branches WHERE id = b AND gym_id = app_gym()) $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY gp_gym_tables() || gp_branch_tables() || ARRAY['gyms'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant ON %I', t);
  END LOOP;
  FOREACH t IN ARRAY gp_branch_tables() LOOP
    EXECUTE format($p$CREATE POLICY tenant ON %I
      USING (gym_id = app_gym() AND (app_branch() IS NULL OR branch_id = app_branch()))
      WITH CHECK (gym_id = app_gym() AND (app_branch() IS NULL OR branch_id = app_branch()) AND branch_in_gym(branch_id))$p$, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['settings','whatsapp_settings','message_templates','invoice_counters','gym_counters','photos'] LOOP
    EXECUTE format('CREATE POLICY tenant ON %I USING (gym_id = app_gym()) WITH CHECK (gym_id = app_gym())', t);
  END LOOP;
END $$;
CREATE POLICY tenant ON users
  USING (gym_id = app_gym() AND (app_branch() IS NULL OR branch_id IS NULL OR branch_id = app_branch()))
  WITH CHECK (gym_id = app_gym() AND (branch_id IS NULL OR branch_in_gym(branch_id)));
CREATE POLICY tenant ON branches
  USING (gym_id = app_gym() AND (app_branch() IS NULL OR id = app_branch()))
  WITH CHECK (gym_id = app_gym());
CREATE POLICY tenant ON gyms FOR SELECT USING (id = app_gym());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gympilot_tenant') THEN
    CREATE ROLE gympilot_tenant NOLOGIN;
  END IF;
  EXECUTE format('GRANT gympilot_tenant TO %I', current_user);
END $$;
GRANT USAGE ON SCHEMA public TO gympilot_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gympilot_tenant;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gympilot_tenant;
REVOKE INSERT, UPDATE, DELETE ON gyms FROM gympilot_tenant;

-- Settings, WhatsApp settings and built-in message templates for one gym. Safe to run again.
CREATE OR REPLACE FUNCTION gym_defaults(g int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO settings (id, gym_id) VALUES (g, g) ON CONFLICT (id) DO NOTHING;
  INSERT INTO whatsapp_settings (id, gym_id) VALUES (g, g) ON CONFLICT (id) DO NOTHING;
  INSERT INTO message_templates (gym_id, key, name, subject, body, category) VALUES
   (g,'expiry','Membership expiring','Your membership is expiring','Hi {{name}}, your {{plan}} membership at {{gym_name}} ends on {{expiry_date}}. Renew now to keep training without a break.','UTILITY'),
   (g,'expired','Membership expired','Your membership has ended','Hi {{name}}, your membership at {{gym_name}} ended on {{expiry_date}}. We miss you! Visit us or reply here to renew.','UTILITY'),
   (g,'dues','Payment due','Payment reminder','Hi {{name}}, you have a pending balance of Rs {{due_amount}} at {{gym_name}}. Please clear it at your next visit or pay by UPI. Thank you!','UTILITY'),
   (g,'birthday','Birthday wishes','Happy birthday!','Happy birthday {{name}}! Everyone at {{gym_name}} wishes you a strong and healthy year ahead.','MARKETING'),
   (g,'welcome','Welcome','Welcome to {{gym_name}}','Welcome to {{gym_name}}, {{name}}! We are excited to be part of your fitness journey.','MARKETING'),
   (g,'inactive','We miss you','We miss you','Hi {{name}}, we have not seen you at {{gym_name}} for a while. Come back this week and get back on track!','MARKETING'),
   (g,'lead_followup','Enquiry follow-up','Thanks for your enquiry','Hi {{name}}, thanks for your interest in {{gym_name}}. Would you like to book a free trial session this week?','MARKETING'),
   (g,'holiday_closed','Holiday: gym closed','Gym closed on {{holiday_date}}','Dear {{name}}, {{gym_name}} will remain closed on {{holiday_date}} for {{holiday_name}}. We will reopen on {{reopen_date}}. Thank you for your understanding.','UTILITY'),
   (g,'holiday_timings','Holiday: changed timings','Changed timings on {{holiday_date}}','Dear {{name}}, on {{holiday_date}} {{gym_name}} will be open from {{open_time}} to {{close_time}} for {{holiday_name}}. Regular timings resume the next day.','UTILITY'),
   (g,'holiday_wishes','Festival wishes','Happy {{holiday_name}}','Dear {{name}}, wishing you and your family a very happy {{holiday_name}}! Stay healthy and keep training. With warm wishes from {{gym_name}}.','MARKETING')
  ON CONFLICT (gym_id, key) DO NOTHING;
$$;
SELECT gym_defaults(id) FROM gyms;

CREATE VIEW member_overview WITH (security_invoker = true) AS
SELECT m.*,
  ph.photo_v,
  cur.slot_id, cur.slot_name,
  be.device_user_id AS biometric_id,
  cur.id AS membership_id, cur.plan_name, cur.start_date, cur.end_date,
  lim.valid_until,
  CASE
    WHEN cur.id IS NULL THEN 'none'
    WHEN cur.start_date <= gym_today() AND cur.end_date >= gym_today() AND EXISTS (
      SELECT 1 FROM membership_freezes f WHERE f.membership_id = cur.id AND gym_today() BETWEEN f.start_date AND f.end_date) THEN 'frozen'
    WHEN cur.end_date < gym_today() THEN 'expired'
    WHEN cur.start_date > gym_today() THEN 'upcoming'
    ELSE 'active'
  END AS status,
  COALESCE(d.dues, 0) AS dues,
  v.last_visit
FROM members m
LEFT JOIN biometric_enrollments be ON be.member_id = m.id
LEFT JOIN LATERAL (SELECT extract(epoch FROM p.updated_at)::bigint AS photo_v FROM photos p WHERE p.kind = 'member' AND p.ref_id = m.id) ph ON true
LEFT JOIN LATERAL (
  SELECT ms.* FROM memberships ms WHERE ms.member_id = m.id AND ms.status = 'active'
  ORDER BY (gym_today() BETWEEN ms.start_date AND ms.end_date) DESC, ms.end_date DESC LIMIT 1
) cur ON true
LEFT JOIN LATERAL (SELECT max(ms.end_date) AS valid_until FROM memberships ms WHERE ms.member_id = m.id AND ms.status = 'active') lim ON true
LEFT JOIN LATERAL (SELECT sum(i.balance) AS dues FROM invoices i WHERE i.member_id = m.id AND i.status IN ('unpaid','partial')) d ON true
LEFT JOIN LATERAL (SELECT max(a.day) AS last_visit FROM attendance a WHERE a.member_id = m.id) v ON true;

-- Must come after every table and view above.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gympilot_tenant;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gympilot_tenant;
REVOKE INSERT, UPDATE, DELETE ON gyms FROM gympilot_tenant;
