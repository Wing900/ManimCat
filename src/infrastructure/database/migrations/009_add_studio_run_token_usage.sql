alter table if exists studio_runs
  add column if not exists token_usage jsonb;
