create table if not exists studio_sessions (
  id text primary key,
  project_id text not null,
  workspace_id text,
  parent_session_id text references studio_sessions(id) on delete set null,
  agent_type text not null,
  title text not null,
  directory text not null,
  permission_level text not null,
  permission_rules jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists studio_messages (
  id text primary key,
  session_id text not null references studio_sessions(id) on delete cascade,
  role text not null,
  agent text,
  text text,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists studio_message_parts (
  id text primary key,
  message_id text not null references studio_messages(id) on delete cascade,
  session_id text not null references studio_sessions(id) on delete cascade,
  type text not null,
  text text,
  tool text,
  call_id text,
  state jsonb,
  metadata jsonb,
  time jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists studio_runs (
  id text primary key,
  session_id text not null references studio_sessions(id) on delete cascade,
  status text not null,
  input_text text not null,
  active_agent text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  error text
);

create table if not exists studio_tasks (
  id text primary key,
  session_id text not null references studio_sessions(id) on delete cascade,
  run_id text references studio_runs(id) on delete set null,
  work_id text,
  type text not null,
  status text not null,
  title text not null,
  detail text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists studio_works (
  id text primary key,
  session_id text not null references studio_sessions(id) on delete cascade,
  run_id text references studio_runs(id) on delete set null,
  type text not null,
  title text not null,
  status text not null,
  latest_task_id text,
  current_result_id text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists studio_work_results (
  id text primary key,
  work_id text not null references studio_works(id) on delete cascade,
  kind text not null,
  summary text not null,
  attachments jsonb,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_studio_messages_session_created
  on studio_messages(session_id, created_at);

create index if not exists idx_studio_message_parts_message_created
  on studio_message_parts(message_id, created_at);

create index if not exists idx_studio_runs_session_created
  on studio_runs(session_id, created_at desc);

create index if not exists idx_studio_tasks_session_updated
  on studio_tasks(session_id, updated_at desc);

create index if not exists idx_studio_works_session_updated
  on studio_works(session_id, updated_at desc);

create index if not exists idx_studio_work_results_work_created
  on studio_work_results(work_id, created_at);
