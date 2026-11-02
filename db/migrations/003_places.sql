-- ===========================================================================
-- 003 — Places: where each entry was spent.
--
-- Idempotent: safe to run more than once. Additive only: three nullable
-- columns, so every existing row and every existing write is untouched.
--
-- A remark like "Food" says little a month later; "Food · Lulu Mall,
-- Edappally" says which meal. The phone sends its location with an entry or
-- a photo; the app asks the browser when an entry is typed in.
--
-- `place_name` is what a person reads: the name the iPhone resolved, or one
-- looked up from OpenStreetMap after the save. The coordinates are the truth
-- and the name only a label for them, so a name can be missing or replaced
-- without anything else changing.
--
-- None of this is money. The engine never reads these columns, which is why
-- the snapshot does not load them — Entries and the map ask for them apart.
-- ===========================================================================

begin;

alter table transactions add column if not exists place_lat  double precision;
alter table transactions add column if not exists place_lon  double precision;
alter table transactions add column if not exists place_name text;

-- Both or neither: half a coordinate is a pin in the wrong ocean.
alter table transactions drop constraint if exists tx_place_pair;
alter table transactions add constraint tx_place_pair
  check ((place_lat is null) = (place_lon is null));

alter table transactions drop constraint if exists tx_place_range;
alter table transactions add constraint tx_place_range
  check (place_lat is null or (place_lat between -90 and 90 and place_lon between -180 and 180));

alter table transactions drop constraint if exists tx_place_name_len;
alter table transactions add constraint tx_place_name_len
  check (place_name is null or length(place_name) <= 200);

-- Entries and the map ask only for the rows that have a place.
create index if not exists tx_place_idx on transactions (ts) where place_lat is not null;

commit;

-- Tell PostgREST about the new columns now rather than on its next reload.
notify pgrst, 'reload schema';
