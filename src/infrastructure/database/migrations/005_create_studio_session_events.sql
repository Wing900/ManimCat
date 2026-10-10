create table if not exists studio_session_events (
  id text primary key,
  session_id text not null references studio_sessions(id) on delete cascade,
  run_id text references studio_runs(id) on delete set null,
  kind text not null,
  status text not null,
  title text not null,
  summary text not null,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  consumed_at timestamptz
);

create index if not exists idx_studio_session_events_session_created
  on studio_session_events(session_id, created_at);
