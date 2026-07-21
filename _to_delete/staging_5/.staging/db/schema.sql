-- ===========================================================================
-- Personal Finance Manager — Supabase (Postgres) schema
-- Run once in the Supabase SQL Editor (or: psql "$DATABASE_URL" -f db/schema.sql)
--
-- The heavy data (transactions, income) lives in real Postgres tables. App
-- configuration (card settings, budgets, recurring defs, holdings, invoices,
-- credit-status) is stored as JSON in app_config — the same shape the app used
-- for the sheet's AppConfig, so the application logic is unchanged.
-- ===========================================================================

-- Transactions (replaces the Daily Spent "Form Responses 1" sheet).
-- ts is a local-naive IST wall-clock string ("YYYY-MM-DDTHH:MM:SS") so day
-- boundaries match how you enter data. Derived fields are set by the app.
create table if not exists transactions (
  id             text primary key,
  ts             text,
  amount         numeric,
  method         text,
  category       text,
  remarks        text,
  kind           text,
  card_affected  text,
  card_direction text,
  tags           jsonb   default '{}'::jsonb,
  verified       boolean default false,
  needs_review   boolean default false,
  deleted        boolean default false,
  source         text    default 'app',
  created_at     timestamptz default now()
);
create index if not exists idx_tx_ts on transactions (ts);
create index if not exists idx_tx_deleted on transactions (deleted);

-- Income (replaces "Form Responses 2").
create table if not exists income (
  id           text primary key,
  ts           text,
  amount       numeric,
  source       text,
  account      text,
  remarks      text,
  needs_review boolean default false,
  deleted      boolean default false,
  created_at   timestamptz default now()
);
create index if not exists idx_income_ts on income (ts);

-- Key/value config: card settings, budgets, recurring defs, holdings,
-- invoices, credit-status, accounts — each stored as a JSON string.
create table if not exists app_config (
  key   text primary key,
  value text
);

-- Append-only audit log.
create table if not exists events (
  id     bigint generated always as identity primary key,
  at     timestamptz default now(),
  type   text,
  detail text
);

-- Monotonic version counter for cheap client cache invalidation.
create table if not exists app_state (
  key   text primary key,
  value bigint default 0
);
insert into app_state (key, value) values ('version', 0) on conflict (key) do nothing;

create or replace function bump_version() returns trigger as $$
begin
  update app_state set value = value + 1 where key = 'version';
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_tx_version on transactions;
create trigger trg_tx_version after insert or update or delete on transactions
  for each statement execute function bump_version();
drop trigger if exists trg_income_version on income;
create trigger trg_income_version after insert or update or delete on income
  for each statement execute function bump_version();

-- ---------------------------------------------------------------------------
-- Row Level Security: lock the tables down. The app uses the service-role key
-- (which bypasses RLS) on the server. No anon access.
-- ---------------------------------------------------------------------------
alter table transactions enable row level security;
alter table income       enable row level security;
alter table app_config   enable row level security;
alter table events       enable row level security;
alter table app_state    enable row level security;
