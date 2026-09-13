-- ===========================================================================
-- 002 — Captures: a photo taken now, turned into an entry later.
--
-- Idempotent: safe to run more than once.
--
-- The problem this solves is a real one in the data. Entries made days after
-- the fact are the ones with "Unknown food" or a blank method, because the
-- detail was gone by the time there was a minute to type it. A photo of the
-- shop or the bill keeps the detail until there is.
--
-- The image itself lives in Supabase Storage, not here. A row in this table is
-- the pointer plus the state: pending until it becomes an entry, and then
-- either linked to that entry or deliberately discarded. Nothing is deleted —
-- a capture that produced a transaction is the evidence for it.
--
-- `ts` is text for the same reason it is on transactions: IST wall clock with
-- no offset, sorting chronologically as a string.
-- ===========================================================================

begin;

create table if not exists captures (
  id             text primary key,
  -- When the photo was taken, as far as the phone knew.
  ts             text        not null,
  -- Object path inside the storage bucket. Not a URL: the bucket is private
  -- and every read is proxied by the app, so a stored URL would be a
  -- long-lived public handle to a picture of somebody's bill.
  path           text        not null,
  mime           text        not null,
  bytes          integer     not null,
  -- Anything the phone could add for free: a note dictated at the till.
  note           text        default '',
  status         text        not null default 'pending',
  -- Set when the capture has been turned into an entry.
  transaction_id text,
  source         text        default 'shortcut',
  created_at     timestamptz default now(),
  updated_at     timestamptz,
  updated_by     text
);

-- ---------------------------------------------------------------------------
-- Constraints. A capture with no image, or in a state nothing understands, is
-- worse than no capture: it sits in the inbox for ever and cannot be actioned.
-- ---------------------------------------------------------------------------
alter table captures drop constraint if exists cap_status_enum;
alter table captures add constraint cap_status_enum
  check (status in ('pending', 'used', 'discarded'));

alter table captures drop constraint if exists cap_ts_format;
alter table captures add constraint cap_ts_format
  check (ts ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');

alter table captures drop constraint if exists cap_path_present;
alter table captures add constraint cap_path_present
  check (length(trim(path)) > 0);

-- Images only, and bounded. The endpoint enforces this too; the database is
-- the line that holds when something bypasses it.
alter table captures drop constraint if exists cap_mime_image;
alter table captures add constraint cap_mime_image
  check (mime in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'));

alter table captures drop constraint if exists cap_bytes_sane;
alter table captures add constraint cap_bytes_sane
  check (bytes > 0 and bytes <= 20971520);

-- A used capture must say which entry it became; the others must not claim one.
alter table captures drop constraint if exists cap_used_has_entry;
alter table captures add constraint cap_used_has_entry
  check ((status = 'used') = (transaction_id is not null));

-- ---------------------------------------------------------------------------
-- Indexes. The inbox reads one status, newest first, and nothing else.
-- ---------------------------------------------------------------------------
create index if not exists idx_cap_pending on captures (ts desc) where status = 'pending';
create index if not exists idx_cap_status on captures (status);

-- ---------------------------------------------------------------------------
-- Keep updated_at honest without relying on the caller, as on the other tables.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_cap_touch on captures;
create trigger trg_cap_touch before update on captures
  for each row execute function touch_updated_at();

-- A capture changes what the inbox shows, so it has to move the version the
-- snapshot cache checks — otherwise a photo posted from the phone does not
-- appear until something else happens to invalidate the cache.
drop trigger if exists trg_cap_version on captures;
create trigger trg_cap_version after insert or update or delete on captures
  for each statement execute function bump_version();

-- ---------------------------------------------------------------------------
-- Access control, matching the other tables: RLS on, forced for the owner,
-- and no permissive policy. Only the service role reaches this table, and it
-- only ever does so from the server.
-- ---------------------------------------------------------------------------
alter table captures enable row level security;
alter table captures force row level security;
revoke all on captures from anon;
revoke all on captures from authenticated;

commit;
