-- Task 11B1: optional Scene scope for Studio messages, Runs and renders.
-- One migration unit: three nullable columns, the composite relationship that keeps every
-- Scene-scoped child inside its own Session, and the ordered Scene lookup indexes.
-- No legacy row is backfilled: `NULL` stays the truthful "Session-scoped" marker.

alter table if exists studio_messages
  add column if not exists scene_id text;

alter table if exists studio_runs
  add column if not exists scene_id text;

alter table if exists studio_renders
  add column if not exists scene_id text;

-- Composite target. `studio_scenes.id` is already the primary key, but a composite foreign key
-- needs a unique constraint on exactly `(id, session_id)`: that is what lets the child carry its
-- own `session_id` inside the reference instead of trusting it.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = to_regclass('studio_scenes')
       and conname = 'studio_scenes_id_session_key'
  ) then
    alter table studio_scenes
      add constraint studio_scenes_id_session_key unique (id, session_id);
  end if;
end $$;

-- Composite foreign keys. MATCH SIMPLE (the default) exempts a child whose `scene_id` is NULL, so
-- legacy Session-scoped rows stay valid untouched, while every Scene-scoped row is proven to
-- point at a Scene of its own Session. `on delete cascade` makes deleting a Scene drop exactly
-- its own records; the pre-existing Session-level cascades are unchanged.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = to_regclass('studio_messages')
       and conname = 'studio_messages_scene_session_fkey'
  ) then
    alter table studio_messages
      add constraint studio_messages_scene_session_fkey
      foreign key (scene_id, session_id) references studio_scenes(id, session_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = to_regclass('studio_runs')
       and conname = 'studio_runs_scene_session_fkey'
  ) then
    alter table studio_runs
      add constraint studio_runs_scene_session_fkey
      foreign key (scene_id, session_id) references studio_scenes(id, session_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = to_regclass('studio_renders')
       and conname = 'studio_renders_scene_session_fkey'
  ) then
    alter table studio_renders
      add constraint studio_renders_scene_session_fkey
      foreign key (scene_id, session_id) references studio_scenes(id, session_id)
      on delete cascade;
  end if;
end $$;

-- Ordered Scene lookups: `created_at` then `id`, matching the read order of every adapter.
create index if not exists idx_studio_messages_scene_created
  on studio_messages(scene_id, created_at, id);

create index if not exists idx_studio_runs_scene_created
  on studio_runs(scene_id, created_at, id);

create index if not exists idx_studio_renders_scene_created
  on studio_renders(scene_id, created_at, id);
