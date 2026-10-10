-- ============================================================================
-- ManimCat - Render Failure Events
-- 只记录渲染阶段失败事件，用于管理员导出排障
-- ============================================================================

create table if not exists render_failure_events (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  job_id          text not null,
  attempt         integer not null default 1,
  output_mode     text not null check (output_mode in ('video', 'image')),
  error_type      text not null,
  error_message   text not null,
  stderr_preview  text not null,
  stdout_preview  text,
  code_snippet    text,
  full_code       text,
  peak_memory_mb  numeric,
  exit_code       integer,
  recovered       boolean not null default false,
  model           text,
  prompt_version  text,
  prompt_role     text,
  client_id       text,
  concept         text
);

create index if not exists idx_render_failure_events_created_at_desc
  on render_failure_events (created_at desc);

create index if not exists idx_render_failure_events_job_attempt
  on render_failure_events (job_id, attempt);

create index if not exists idx_render_failure_events_error_created
  on render_failure_events (error_type, created_at desc);