alter table if exists studio_runs
  add column if not exists metadata jsonb;
