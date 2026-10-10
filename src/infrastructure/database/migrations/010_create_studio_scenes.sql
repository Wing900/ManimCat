-- Task 11A: ordered Scenes beneath a Studio session.
-- One migration unit: the table, its constraints, its indexes, and the two functions that make
-- the position invariant atomic (append) and impossible to observe half-applied (reorder).

create table if not exists studio_scenes (
  id text primary key,
  owner_id text not null,
  session_id text not null references studio_sessions(id) on delete cascade,
  position integer not null check (position >= 0),
  source_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint studio_scenes_session_position_key unique (session_id, position)
);

create index if not exists idx_studio_scenes_owner_session_position
  on studio_scenes(owner_id, session_id, position asc, id asc);

-- Atomic append: serialize per Session, then take the next free position in the same
-- transaction. The owner check keeps the ownership invariant inside the database.
create or replace function studio_scene_append(
  p_id text,
  p_owner_id text,
  p_session_id text,
  p_source_path text,
  p_created_at timestamptz,
  p_updated_at timestamptz
) returns setof studio_scenes
language plpgsql
as $$
declare
  v_position integer;
begin
  if not exists (
    select 1 from studio_sessions where id = p_session_id and owner_id = p_owner_id
  ) then
    raise exception 'studio_scene_append: session does not belong to owner'
      using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id, 0));

  select coalesce(max(position) + 1, 0) into v_position
    from studio_scenes
   where session_id = p_session_id;

  return query
    insert into studio_scenes (id, owner_id, session_id, position, source_path, created_at, updated_at)
    values (
      p_id,
      p_owner_id,
      p_session_id,
      v_position,
      p_source_path,
      coalesce(p_created_at, now()),
      coalesce(p_updated_at, now())
    )
    returning *;
end;
$$;

-- Atomic reorder: the submitted list must be exactly the persisted Scene set of that Session.
-- `unique (session_id, position)` is enforced per row, so a permutation would collide midway.
-- Every row therefore leaves the target range first, then 0..n-1 is assigned in one statement.
create or replace function studio_scene_replace_order(
  p_owner_id text,
  p_session_id text,
  p_scene_ids text[]
) returns setof studio_scenes
language plpgsql
as $$
declare
  v_persisted integer;
  v_matched integer;
  v_submitted integer;
  v_lift integer;
begin
  v_submitted := coalesce(array_length(p_scene_ids, 1), 0);
  if v_submitted = 0 then
    raise exception 'studio_scene_replace_order: the order must not be empty'
      using errcode = 'P0003';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id, 0));

  select count(*) into v_persisted
    from studio_scenes
   where owner_id = p_owner_id and session_id = p_session_id;

  select count(*) into v_matched
    from (
      select distinct ids.id
        from unnest(p_scene_ids) as ids(id)
        join studio_scenes s
          on s.id = ids.id and s.owner_id = p_owner_id and s.session_id = p_session_id
    ) as matched;

  if v_submitted <> v_persisted or v_matched <> v_persisted then
    raise exception 'studio_scene_replace_order: order does not match the persisted scene set'
      using errcode = 'P0004';
  end if;

  -- Lift every row strictly above the current maximum, so the source range and the temporary
  -- range cannot overlap even when legacy rows left gaps behind.
  select max(position) + 1 into v_lift
    from studio_scenes
   where owner_id = p_owner_id and session_id = p_session_id;

  update studio_scenes
     set position = position + v_lift,
         updated_at = now()
   where owner_id = p_owner_id and session_id = p_session_id;

  update studio_scenes as s
     set position = (ordered.ordinality - 1)::integer,
         updated_at = now()
    from unnest(p_scene_ids) with ordinality as ordered(id, ordinality)
   where s.id = ordered.id
     and s.owner_id = p_owner_id
     and s.session_id = p_session_id;

  return query
    select *
      from studio_scenes
     where owner_id = p_owner_id and session_id = p_session_id
     order by position asc, id asc;
end;
$$;
