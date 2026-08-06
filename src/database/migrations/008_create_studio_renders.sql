create table if not exists studio_renders (
  id text primary key,
  owner_id text not null,
  session_id text not null references studio_sessions(id) on delete cascade,
  run_id text references studio_runs(id) on delete set null,
  kind text not null,
  title text not null,
  status text not null,
  concept text not null,
  output_mode text not null,
  quality text,
  job_id text,
  source_path text,
  attachments jsonb,
  error text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_studio_renders_owner_session_created
  on studio_renders(owner_id, session_id, created_at desc);
