-- Migration 013: CatKey access — key registry and per-source token usage.
--
-- Two tables, one issuing function and one reporting view. Everything here is reached only by the
-- server (service role key); the browser never holds a Supabase credential, so no policy is written
-- for `anon` / `authenticated` at all. RLS stays enabled with zero policies as a second lock, and
-- the issuing function and the view are explicitly revoked from the API-facing roles.

-- ----------------------------------------------------------------------------
-- 1. cat_keys — the registry of issued CatKeys.
--
-- Only the SHA-256 of a CatKey is stored. `key_prefix` is the maintainer-facing handle used to
-- revoke a key without ever holding its plaintext.
-- ----------------------------------------------------------------------------
create table if not exists cat_keys (
  id           uuid primary key default gen_random_uuid(),
  key_hash     text not null unique,
  key_prefix   text not null,
  label        text,
  status       text not null default 'active'
    check (status in ('active', 'revoked')),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists idx_cat_keys_status on cat_keys (status);

-- Revocation is looked up by prefix in the SQL Editor, and the resolver looks up by hash.
create unique index if not exists idx_cat_keys_prefix on cat_keys (key_prefix);

alter table cat_keys enable row level security;

-- ----------------------------------------------------------------------------
-- 2. cat_key_usage — one row per Workflow Job or Studio Run, holding its current cumulative value.
--
-- The token counters are checkpointed, not appended: a Studio Run may report usage several times
-- while it is still running, so every write upserts onto `(source_kind, source_id)` and overwrites
-- the totals. `request_count` is therefore the row count, and no separate counter exists.
-- ----------------------------------------------------------------------------
create table if not exists cat_key_usage (
  id                uuid primary key default gen_random_uuid(),
  cat_key_id        uuid not null references cat_keys (id) on delete cascade,
  source_kind       text not null
    check (source_kind in ('workflow_job', 'studio_run')),
  source_id         text not null,
  model             text not null,
  prompt_tokens     bigint not null default 0,
  completion_tokens bigint not null default 0,
  total_tokens      bigint not null default 0,
  measured_calls    integer not null default 0,
  unmeasured_calls  integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- The upsert target. Declared as a constraint (not just an index) so the recorder can name it, and
-- it must stay in step with `CONFLICT_TARGET` in supabase-usage-repository.ts. `cat_key_id` leads
-- so a Job id can never be overwritten across two different CatKeys.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = to_regclass('cat_key_usage')
       and conname = 'cat_key_usage_source_key'
  ) then
    alter table cat_key_usage
      add constraint cat_key_usage_source_key unique (cat_key_id, source_kind, source_id);
  end if;
end $$;

create index if not exists idx_cat_key_usage_key_created
  on cat_key_usage (cat_key_id, created_at desc);

-- The summary groups by `cat_key_id`; this covers the join without touching the heap.
create index if not exists idx_cat_key_usage_key_id on cat_key_usage (cat_key_id);

alter table cat_key_usage enable row level security;

-- ----------------------------------------------------------------------------
-- 3. issue_cat_key() — mint one CatKey and return its plaintext exactly once.
--
-- Called from the Supabase SQL Editor as the project owner:
--
--     select * from issue_cat_key('小王测试');
--
-- The plaintext is returned by the call and never persisted; only its hash and prefix are.
-- ----------------------------------------------------------------------------
create or replace function issue_cat_key (p_label text default null)
returns table (
  cat_key    text,
  key_prefix text,
  label      text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_prefix text;
begin
  -- 32 random bytes from pgcrypto, hex-encoded so the key is URL- and header-safe.
  v_secret := 'mc_' || encode(gen_random_bytes(32), 'hex');
  v_prefix := substr(v_secret, 1, 11); -- 'mc_' plus 8 hex characters

  insert into cat_keys (key_hash, key_prefix, label)
  values (
    encode(digest(v_secret, 'sha256'), 'hex'),
    v_prefix,
    nullif(btrim(coalesce(p_label, '')), '')
  );

  return query
    select v_secret, v_prefix, nullif(btrim(coalesce(p_label, '')), ''), now();
end;
$$;

-- A `public` function is exposed by PostgREST as POST /rest/v1/rpc/issue_cat_key, and PostgreSQL
-- grants EXECUTE to PUBLIC by default. Without this revoke, anyone holding the project's anon key
-- could mint unlimited CatKeys. Signing stays a maintainer-only, SQL-Editor-only action.
revoke all on function issue_cat_key (text) from public;
revoke all on function issue_cat_key (text) from anon;
revoke all on function issue_cat_key (text) from authenticated;

-- ----------------------------------------------------------------------------
-- 4. cat_key_usage_summary — the maintainer's roll-up. Replaces any admin backend.
--
--     select * from cat_key_usage_summary order by created_at desc;
-- ----------------------------------------------------------------------------
create or replace view cat_key_usage_summary
with (security_invoker = true)
as
select
  k.id                                as cat_key_id,
  k.key_prefix,
  k.label,
  k.status,
  k.last_used_at,
  k.created_at,
  count(u.id)                         as request_count,
  coalesce(sum(u.prompt_tokens), 0)   as prompt_tokens,
  coalesce(sum(u.completion_tokens), 0) as completion_tokens,
  coalesce(sum(u.total_tokens), 0)    as total_tokens,
  coalesce(sum(u.measured_calls), 0)  as measured_calls,
  coalesce(sum(u.unmeasured_calls), 0) as unmeasured_calls
from cat_keys k
left join cat_key_usage u on u.cat_key_id = k.id
group by k.id;

-- Views are exposed by PostgREST as well. The service role bypasses these grants; nobody else
-- should read the usage roll-up.
revoke all on cat_key_usage_summary from public;
revoke all on cat_key_usage_summary from anon;
revoke all on cat_key_usage_summary from authenticated;
