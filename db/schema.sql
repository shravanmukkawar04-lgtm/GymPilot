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
INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING;

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

INSERT INTO message_templates (key, name, subject, body) VALUES
 ('expiry','Membership expiring','Your membership is expiring','Hi {{name}}, your {{plan}} membership at {{gym_name}} ends on {{expiry_date}}. Renew now to keep training without a break.'),
 ('expired','Membership expired','Your membership has ended','Hi {{name}}, your membership at {{gym_name}} ended on {{expiry_date}}. We miss you! Visit us or reply here to renew.'),
 ('dues','Payment due','Payment reminder','Hi {{name}}, you have a pending balance of Rs {{due_amount}} at {{gym_name}}. Please clear it at your next visit or pay by UPI. Thank you!'),
 ('birthday','Birthday wishes','Happy birthday!','Happy birthday {{name}}! Everyone at {{gym_name}} wishes you a strong and healthy year ahead.'),
 ('welcome','Welcome','Welcome to {{gym_name}}','Welcome to {{gym_name}}, {{name}}! We are excited to be part of your fitness journey.'),
 ('inactive','We miss you','We miss you','Hi {{name}}, we have not seen you at {{gym_name}} for a while. Come back this week and get back on track!'),
 ('lead_followup','Enquiry follow-up','Thanks for your enquiry','Hi {{name}}, thanks for your interest in {{gym_name}}. Would you like to book a free trial session this week?')
ON CONFLICT (key) DO NOTHING;

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
INSERT INTO whatsapp_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

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

INSERT INTO message_templates (key, name, subject, body, category) VALUES
 ('holiday_closed','Holiday: gym closed','Gym closed on {{holiday_date}}','Dear {{name}}, {{gym_name}} will remain closed on {{holiday_date}} for {{holiday_name}}. We will reopen on {{reopen_date}}. Thank you for your understanding.','UTILITY'),
 ('holiday_timings','Holiday: changed timings','Changed timings on {{holiday_date}}','Dear {{name}}, on {{holiday_date}} {{gym_name}} will be open from {{open_time}} to {{close_time}} for {{holiday_name}}. Regular timings resume the next day.','UTILITY'),
 ('holiday_wishes','Festival wishes','Happy {{holiday_name}}','Dear {{name}}, wishing you and your family a very happy {{holiday_name}}! Stay healthy and keep training. With warm wishes from {{gym_name}}.','MARKETING')
ON CONFLICT (key) DO NOTHING;

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

DROP VIEW IF EXISTS member_overview;
CREATE VIEW member_overview AS
SELECT m.*,
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
LEFT JOIN LATERAL (
  SELECT ms.* FROM memberships ms WHERE ms.member_id = m.id AND ms.status = 'active'
  ORDER BY (gym_today() BETWEEN ms.start_date AND ms.end_date) DESC, ms.end_date DESC LIMIT 1
) cur ON true
LEFT JOIN LATERAL (SELECT max(ms.end_date) AS valid_until FROM memberships ms WHERE ms.member_id = m.id AND ms.status = 'active') lim ON true
LEFT JOIN LATERAL (SELECT sum(i.balance) AS dues FROM invoices i WHERE i.member_id = m.id AND i.status IN ('unpaid','partial')) d ON true
LEFT JOIN LATERAL (SELECT max(a.day) AS last_visit FROM attendance a WHERE a.member_id = m.id) v ON true;
