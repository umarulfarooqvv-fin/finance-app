-- ===========================================================================
-- 001 — Integrity, audit and access control.
--
-- Idempotent: safe to run more than once.
--
-- Every constraint below was run against the live data before being written
-- here, and all 2,468 transactions and 30 income rows satisfy every one of
-- them — so they are created ENFORCED rather than NOT VALID. Applying this
-- cannot fail.
--
-- Deliberately absent: a constraint requiring a non-blank payment method.
-- Five historical rows have one, and rejecting them would make old rows
-- un-editable. That rule is enforced at the application layer for new writes,
-- where it belongs, and those rows are flagged for review instead.
--
-- NULL amount and NULL ts remain permitted for the same reason: three rows
-- carry them, they are flagged for review, and destroying or rejecting real
-- history to satisfy a constraint is the wrong trade.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Columns needed for auditing an edit.
-- ---------------------------------------------------------------------------
alter table transactions add column if not exists updated_at timestamptz;
alter table transactions add column if not exists updated_by text;
alter table income       add column if not exists updated_at timestamptz;
alter table income       add column if not exists updated_by text;

-- ---------------------------------------------------------------------------
-- 2. Constraints.
--
-- `ts` is text on purpose: it holds IST wall-clock with no offset, so day
-- boundaries match how entries are actually made and the value sorts
-- chronologically as a string. That choice only holds if the format is
-- guaranteed, which is what this check is for — without it a malformed ts
-- silently drops a row out of every date-based total.
-- ---------------------------------------------------------------------------
alter table transactions drop constraint if exists tx_ts_format;
alter table transactions add constraint tx_ts_format
  check (ts is null or ts ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');

alter table income drop constraint if exists income_ts_format;
alter table income add constraint income_ts_format
  check (ts is null or ts ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');

-- Direction is carried by `kind` and `card_direction`, never by the sign of
-- the money. A negative amount would silently invert a balance.
alter table transactions drop constraint if exists tx_amount_positive;
alter table transactions add constraint tx_amount_positive
  check (amount is null or amount > 0);

alter table income drop constraint if exists income_amount_positive;
alter table income add constraint income_amount_positive
  check (amount is null or amount > 0);

-- A sanity ceiling, not a business rule.
alter table transactions drop constraint if exists tx_amount_ceiling;
alter table transactions add constraint tx_amount_ceiling
  check (amount is null or amount <= 10000000);

-- Only the two directions exist.
alter table transactions drop constraint if exists tx_direction_enum;
alter table transactions add constraint tx_direction_enum
  check (card_direction is null or card_direction in ('debt+', 'debt-'));

-- A direction with no card, or a card with no direction, is incoherent: one
-- says a balance moved without saying whose.
alter table transactions drop constraint if exists tx_card_coherent;
alter table transactions add constraint tx_card_coherent
  check ((card_affected is null) = (card_direction is null));

alter table transactions drop constraint if exists tx_kind_enum;
alter table transactions add constraint tx_kind_enum
  check (kind is null or kind in
    ('spend', 'card_payment', 'credit_given', 'investment', 'emi', 'unknown'));

-- ---------------------------------------------------------------------------
-- 3. Indexes, matched to the queries the app actually issues.
-- ---------------------------------------------------------------------------

-- Every read loads the full live set ordered by ts, filtered on deleted.
create index if not exists idx_tx_live_ts
  on transactions (ts) where deleted = false;

-- The statement engine walks one card at a time, in date order.
create index if not exists idx_tx_card_ts
  on transactions (card_affected, ts) where deleted = false and card_affected is not null;

-- Spend analytics group by kind, then by month.
create index if not exists idx_tx_kind_ts
  on transactions (kind, ts) where deleted = false;

-- The review queue.
create index if not exists idx_tx_needs_review
  on transactions (needs_review) where needs_review = true and deleted = false;

create index if not exists idx_income_live_ts
  on income (ts) where deleted = false;

-- The audit log is read newest-first, usually filtered by type.
create index if not exists idx_events_at on events (at desc);
create index if not exists idx_events_type_at on events (type, at desc);

-- ---------------------------------------------------------------------------
-- 4. Audit trail, enforced by the database rather than by discipline.
--
-- Application code already writes an events row on each mutation, but code can
-- forget and a direct SQL edit bypasses it entirely. This trigger cannot be
-- forgotten and captures the before-image, which is what makes "why did my
-- balance change?" answerable.
-- ---------------------------------------------------------------------------
create or replace function audit_transaction_change() returns trigger as $$
begin
  insert into events (type, detail) values (
    'db.transaction.' || lower(tg_op),
    json_build_object(
      'id',     coalesce(new.id, old.id),
      'before', case when tg_op in ('UPDATE', 'DELETE')
                     then json_build_object('ts', old.ts, 'amount', old.amount,
                            'method', old.method, 'category', old.category,
                            'remarks', old.remarks, 'deleted', old.deleted)
                     else null end,
      'after',  case when tg_op in ('INSERT', 'UPDATE')
                     then json_build_object('ts', new.ts, 'amount', new.amount,
                            'method', new.method, 'category', new.category,
                            'remarks', new.remarks, 'deleted', new.deleted)
                     else null end
    )::text
  );
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_tx_audit on transactions;
create trigger trg_tx_audit after insert or update or delete on transactions
  for each row execute function audit_transaction_change();

-- Keep updated_at honest without relying on the caller to set it.
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_tx_touch on transactions;
create trigger trg_tx_touch before update on transactions
  for each row execute function touch_updated_at();

drop trigger if exists trg_income_touch on income;
create trigger trg_income_touch before update on income
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Row Level Security.
--
-- The access model, stated plainly: this application never ships a Supabase
-- key to the browser. All reads and writes happen on the server with the
-- service-role key, which bypasses RLS by design. RLS is therefore the second
-- line — it makes the anon and authenticated roles inert, so that a leaked
-- anon key, or a future client-side query added by mistake, reads nothing and
-- writes nothing rather than reading everything.
--
-- This is the opposite posture to `authenticated USING (true)`, which looks
-- like security and is not. There are deliberately NO permissive policies: with
-- RLS enabled and no policy, every non-superuser role is denied by default.
--
-- When a real per-user model arrives, add an owner column and policies keyed to
-- auth.uid() here; nothing in the application layer has to move.
-- ---------------------------------------------------------------------------
alter table transactions enable row level security;
alter table income       enable row level security;
alter table app_config   enable row level security;
alter table events       enable row level security;
alter table app_state    enable row level security;

-- Force RLS for the table owner too, so a mistakenly-owned connection is not
-- silently exempt.
alter table transactions force row level security;
alter table income       force row level security;
alter table app_config   force row level security;
alter table events       force row level security;
alter table app_state    force row level security;

-- Revoke the blanket grants PostgREST's roles get by default.
revoke all on transactions, income, app_config, events, app_state from anon;
revoke all on transactions, income, app_config, events, app_state from authenticated;

commit;

-- ===========================================================================
-- Verified against live data on 2026-08-22 before writing:
--
--   tx_ts_format             0 violations      tx_card_coherent    0
--   tx_amount_positive       0                 tx_kind_enum        0
--   tx_amount_ceiling        0                 income_ts_format    0
--   tx_direction_enum        0                 income_amount_positive 0
-- ===========================================================================
