-- Study Hall Management — core schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('master','staff')) DEFAULT 'staff',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, phone)
);

CREATE TABLE halls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,               -- e.g. 'nice', 'nandi', 'nicecl'
  name TEXT NOT NULL,
  upi_id TEXT,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

-- The physical seat inventory / floor plan for a hall
CREATE TABLE seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hall_id UUID NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
  seat_number INT NOT NULL,
  is_locker BOOLEAN NOT NULL DEFAULT false,
  is_pillar BOOLEAN NOT NULL DEFAULT false,  -- structural, never assignable
  fee_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  advance_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  UNIQUE (hall_id, seat_number)
);

-- Students — one row per active occupancy
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hall_id UUID NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
  seat_id UUID UNIQUE REFERENCES seats(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  dob DATE,
  gender TEXT,
  mobile TEXT NOT NULL,
  aadhar_number TEXT,
  photo_url TEXT,
  aadhar_photo_url TEXT,
  password_hash TEXT NOT NULL,
  fee_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  fee_paid BOOLEAN NOT NULL DEFAULT false,
  join_date DATE,
  expiry_date DATE,
  vacating BOOLEAN NOT NULL DEFAULT false,
  vacate_effective_date DATE,
  refund_eligible BOOLEAN,
  refund_amount NUMERIC(10,2),
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hall_id, mobile)
);

-- Payment ledger — the single source of truth for money
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hall_id UUID NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  seat_number INT,
  amount NUMERIC(10,2) NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash','upi')),
  gateway_order_id TEXT,
  gateway_payment_id TEXT,
  gateway_signature TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','failed')) DEFAULT 'pending',
  type TEXT NOT NULL CHECK (type IN ('joining','renewal','seat_change','refund')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ
);

-- New student applications, before a seat is confirmed
CREATE TABLE signup_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hall_id UUID NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
  seat_id_requested UUID REFERENCES seats(id),
  name TEXT NOT NULL,
  dob DATE,
  gender TEXT,
  mobile TEXT NOT NULL,
  aadhar_number TEXT,
  photo_url TEXT,
  aadhar_photo_url TEXT,
  password_hash TEXT NOT NULL,
  fee_amount NUMERIC(10,2),
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','rejected')) DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE seat_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  from_seat_id UUID NOT NULL REFERENCES seats(id),
  to_seat_id UUID NOT NULL REFERENCES seats(id),
  amount NUMERIC(10,2) NOT NULL DEFAULT 100,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','rejected')) DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vacate_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  refund_eligible BOOLEAN NOT NULL,
  refund_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','rejected')) DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('admin','student','system')),
  actor_id UUID,
  action TEXT NOT NULL,
  target_table TEXT,
  target_id UUID,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_seats_hall ON seats(hall_id);
CREATE INDEX idx_students_hall ON students(hall_id);
CREATE INDEX idx_students_mobile ON students(mobile);
CREATE INDEX idx_payments_hall ON payments(hall_id);
CREATE INDEX idx_payments_student ON payments(student_id);
CREATE INDEX idx_signups_hall_status ON signup_applications(hall_id, status);
