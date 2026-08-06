alter table if exists studio_sessions
  add column if not exists owner_id text;

alter table if exists studio_runs
  add column if not exists owner_id text;

create index if not exists idx_studio_sessions_owner_id
  on studio_sessions(owner_id, created_at desc);

create index if not exists idx_studio_runs_owner_session_created
  on studio_runs(owner_id, session_id, created_at desc);

-- Existing rows intentionally remain legacy-owned until an operator maps them
-- to an authenticated owner. New Studio writes always include owner_id.
