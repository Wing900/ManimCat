-- ============================================================================
-- ManimCat - History 表
-- 在 Supabase SQL Editor 中执行此脚本
-- ============================================================================

-- 历史记录表：存储每次生成任务的文字信息（不存储视频/图片）
create table if not exists history (
  id          uuid primary key default gen_random_uuid(),
  client_id   text not null,
  prompt      text not null,
  code        text,
  output_mode text not null check (output_mode in ('video', 'image')),
  quality     text not null check (quality in ('low', 'medium', 'high')),
  status      text not null check (status in ('completed', 'failed')),
  error       text, -- 存储错误原因
  created_at  timestamptz not null default now()
);

-- 按 client_id + 时间倒序查询索引
create index if not exists idx_history_client_created
  on history (client_id, created_at desc);

-- 添加状态索引以便按状态查询（如统计或分析错误）
create index if not exists idx_history_status
  on history (status);

-- RLS 策略（可选：如果启用了 Row Level Security）
-- alter table history enable row level security;
-- create policy "Allow all for anon" on history for all using (true);
