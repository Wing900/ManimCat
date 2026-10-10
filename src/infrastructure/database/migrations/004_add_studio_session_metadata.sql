alter table if exists studio_sessions
  add column if not exists metadata jsonb;
