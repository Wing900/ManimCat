-- ============================================================================
-- ManimCat - 数据库初始化脚本 (Supabase / PostgreSQL)
-- 包含：History 表、Usage Stats 表 以及 原子统计函数
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. History 表：存储用户生成的 Manim 代码和任务状态
-- ----------------------------------------------------------------------------
create table if not exists history (
  id          uuid primary key default gen_random_uuid(),
  client_id   text not null,
  prompt      text not null,
  code        text,
  output_mode text not null check (output_mode in ('video', 'image')),
  quality     text not null check (quality in ('low', 'medium', 'high')),
  status      text not null check (status in ('completed', 'failed')),
  error       text, -- 存储失败原因
  created_at  timestamptz not null default now()
);

-- 索引优化
create index if not exists idx_history_client_created on history (client_id, created_at desc);
create index if not exists idx_history_status on history (status);

-- ----------------------------------------------------------------------------
-- 2. Usage Stats 表：存储每日用量汇总统计（持久化）
-- ----------------------------------------------------------------------------
create table if not exists usage_stats (
  date               date primary key, -- 日期 (YYYY-MM-DD)
  submitted_total    integer default 0,
  submitted_generate integer default 0,
  submitted_modify   integer default 0,
  completed_total    integer default 0,
  failed_total       integer default 0,
  cancelled_total    integer default 0,
  completed_video    integer default 0,
  completed_image    integer default 0,
  render_ms_sum      bigint default 0,
  updated_at         timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- 3. 原子统计更新函数 (RPC)
-- 用于高效、安全地在数据库层面执行“加 1”操作，防止并发冲突
-- ----------------------------------------------------------------------------
create or replace function increment_usage(
  target_date date,
  inc_submitted_total int default 0,
  inc_submitted_generate int default 0,
  inc_submitted_modify int default 0,
  inc_completed_total int default 0,
  inc_failed_total int default 0,
  inc_cancelled_total int default 0,
  inc_completed_video int default 0,
  inc_completed_image int default 0,
  inc_render_ms_sum bigint default 0
)
returns void
language plpgsql
security definer
as $$
begin
  insert into usage_stats (
    date,
    submitted_total,
    submitted_generate,
    submitted_modify,
    completed_total,
    failed_total,
    cancelled_total,
    completed_video,
    completed_image,
    render_ms_sum
  )
  values (
    target_date,
    inc_submitted_total,
    inc_submitted_generate,
    inc_submitted_modify,
    inc_completed_total,
    inc_failed_total,
    inc_cancelled_total,
    inc_completed_video,
    inc_completed_image,
    inc_render_ms_sum
  )
  on conflict (date) do update
  set
    submitted_total    = usage_stats.submitted_total + excluded.submitted_total,
    submitted_generate = usage_stats.submitted_generate + excluded.submitted_generate,
    submitted_modify   = usage_stats.submitted_modify + excluded.submitted_modify,
    completed_total    = usage_stats.completed_total + excluded.completed_total,
    failed_total       = usage_stats.failed_total + excluded.failed_total,
    cancelled_total    = usage_stats.cancelled_total + excluded.cancelled_total,
    completed_video    = usage_stats.completed_video + excluded.completed_video,
    completed_image    = usage_stats.completed_image + excluded.completed_image,
    render_ms_sum      = usage_stats.render_ms_sum + excluded.render_ms_sum,
    updated_at         = now();
end;
$$;
