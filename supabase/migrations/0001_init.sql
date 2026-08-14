-- PVP fighting game: core schema
create extension if not exists pgcrypto;

-- ========== profiles ==========
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  avatar_url text,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_username_ci on public.profiles (lower(username)) where username is not null;

alter table public.profiles enable row level security;
create policy "profiles readable by authenticated" on public.profiles
  for select to authenticated using (true);
create policy "own profile update" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name, is_anonymous)
  values (
    new.id,
    nullif(new.raw_user_meta_data->>'username', ''),
    coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), '玩家' || substr(new.id::text, 1, 6)),
    coalesce(new.is_anonymous, false)
  )
  on conflict (id) do nothing;
  insert into public.player_settings (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ========== fighters ==========
create table public.fighters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text,
  thumbnail_path text,
  original_image_path text,
  rig_manifest jsonb not null default '{}',
  animation_config jsonb not null default '{}',
  collider_config jsonb not null default '{}',
  is_ready boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index fighters_owner_idx on public.fighters(owner_id);

alter table public.fighters enable row level security;
create policy "own fighters all" on public.fighters
  for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
-- opponents may read fighters used in an active match with them
create policy "match opponents read fighters" on public.fighters
  for select to authenticated using (
    exists (
      select 1 from public.matches m
      where m.status in ('matched','loading','ready','active')
        and (m.player_one_id = auth.uid() or m.player_two_id = auth.uid())
        and (m.player_one_fighter_id = fighters.id::text or m.player_two_fighter_id = fighters.id::text)
    )
  );

create table public.fighter_parts (
  id uuid primary key default gen_random_uuid(),
  fighter_id uuid not null references public.fighters(id) on delete cascade,
  part_type text not null,
  storage_path text not null,
  width int not null,
  height int not null,
  pivot_x real not null default 0,
  pivot_y real not null default 0,
  sort_order int not null default 0,
  metadata jsonb not null default '{}'
);
create index fighter_parts_fighter_idx on public.fighter_parts(fighter_id);

alter table public.fighter_parts enable row level security;
create policy "own parts all" on public.fighter_parts
  for all to authenticated using (
    exists (select 1 from public.fighters f where f.id = fighter_id and f.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.fighters f where f.id = fighter_id and f.owner_id = auth.uid())
  );
create policy "match opponents read parts" on public.fighter_parts
  for select to authenticated using (
    exists (
      select 1 from public.matches m
      where m.status in ('matched','loading','ready','active')
        and (m.player_one_id = auth.uid() or m.player_two_id = auth.uid())
        and (m.player_one_fighter_id = fighter_parts.fighter_id::text or m.player_two_fighter_id = fighter_parts.fighter_id::text)
    )
  );

-- ========== player settings ==========
create table public.player_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  selected_fighter_id text,
  master_volume real not null default 0.7,
  sound_enabled boolean not null default true,
  control_config jsonb not null default '{}',
  auto_friend_after_match boolean not null default true,
  allow_friend_requests boolean not null default true,
  allow_fight_invites boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.player_settings enable row level security;
create policy "own settings all" on public.player_settings
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ========== matchmaking ==========
create table public.matchmaking_queue (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  fighter_id text not null,
  status text not null default 'waiting',
  region text not null default 'default',
  match_id uuid,
  created_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now()
);
create unique index one_queue_entry_per_player on public.matchmaking_queue(player_id);

alter table public.matchmaking_queue enable row level security;
create policy "own queue entries" on public.matchmaking_queue
  for all to authenticated using (auth.uid() = player_id) with check (auth.uid() = player_id);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  player_one_id uuid not null references public.profiles(id) on delete cascade,
  player_two_id uuid not null references public.profiles(id) on delete cascade,
  player_one_fighter_id text not null,
  player_two_fighter_id text not null,
  host_player_id uuid not null,
  status text not null default 'matched',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  ended_by uuid,
  end_reason text,
  active_duration_seconds int,
  auto_friend_processed_at timestamptz
);
create index matches_p1_idx on public.matches(player_one_id, status);
create index matches_p2_idx on public.matches(player_two_id, status);

alter table public.matches enable row level security;
create policy "participants read matches" on public.matches
  for select to authenticated using (auth.uid() in (player_one_id, player_two_id));

create table public.match_players (
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  fighter_id text not null,
  joined_at timestamptz,
  ready_at timestamptz,
  left_at timestamptz,
  connection_status text not null default 'pending',
  primary key (match_id, player_id)
);
alter table public.match_players enable row level security;
create policy "own match_players row" on public.match_players
  for all to authenticated using (auth.uid() = player_id) with check (auth.uid() = player_id);
create policy "participants read match_players" on public.match_players
  for select to authenticated using (
    exists (select 1 from public.matches m where m.id = match_id and auth.uid() in (m.player_one_id, m.player_two_id))
  );

-- ========== atomic matchmaking RPC ==========
-- Joins the queue (or refreshes heartbeat). If an opponent is waiting, atomically
-- creates the match. Returns the match row when matched, otherwise nothing.
create or replace function public.try_matchmake(p_fighter_id text)
returns setof public.matches
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_opponent public.matchmaking_queue;
  v_match public.matches;
  v_existing public.matches;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  -- already in an ongoing match?
  select * into v_existing from public.matches
    where status in ('matched','loading','ready','active')
      and (player_one_id = v_me or player_two_id = v_me)
    order by created_at desc limit 1;
  if found then
    delete from public.matchmaking_queue where player_id = v_me;
    return next v_existing;
    return;
  end if;

  -- upsert my queue entry
  insert into public.matchmaking_queue (player_id, fighter_id)
  values (v_me, p_fighter_id)
  on conflict (player_id) do update set heartbeat_at = now(), fighter_id = excluded.fighter_id;

  -- clean stale queue entries (no heartbeat for 30s)
  delete from public.matchmaking_queue where heartbeat_at < now() - interval '30 seconds';

  -- pick a waiting opponent (row-locked to avoid races)
  select * into v_opponent from public.matchmaking_queue
    where player_id <> v_me and status = 'waiting'
    order by created_at
    for update skip locked
    limit 1;

  if not found then
    return;
  end if;

  insert into public.matches (player_one_id, player_two_id, player_one_fighter_id, player_two_fighter_id, host_player_id, status)
  values (v_opponent.player_id, v_me, v_opponent.fighter_id, p_fighter_id, v_opponent.player_id, 'matched')
  returning * into v_match;

  insert into public.match_players (match_id, player_id, fighter_id, joined_at)
  values (v_match.id, v_opponent.player_id, v_opponent.fighter_id, now()),
         (v_match.id, v_me, p_fighter_id, now());

  delete from public.matchmaking_queue where player_id in (v_me, v_opponent.player_id);

  return next v_match;
end $$;

create or replace function public.mark_match_started(p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.matches set status = 'active', started_at = coalesce(started_at, now())
  where id = p_match_id
    and auth.uid() in (player_one_id, player_two_id)
    and status in ('matched','loading','ready');
end $$;

create or replace function public.end_match(p_match_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.matches
    set status = 'ended',
        ended_at = now(),
        ended_by = auth.uid(),
        end_reason = p_reason,
        active_duration_seconds = case when started_at is not null
          then extract(epoch from (now() - started_at))::int else null end
  where id = p_match_id
    and auth.uid() in (player_one_id, player_two_id)
    and status <> 'ended';
end $$;

-- cleanup helper: expire matches that never started
create or replace function public.cleanup_stale_matches()
returns void language sql security definer set search_path = public as $$
  update public.matches set status = 'ended', ended_at = now(), end_reason = 'timeout'
  where status in ('matched','loading','ready') and created_at < now() - interval '2 minutes';
$$;

-- ========== realtime private channel authorization ==========
-- Only match participants may join/send on topic 'match:{matchId}'.
create policy "match participants can receive broadcast"
on realtime.messages for select to authenticated
using (
  exists (
    select 1 from public.matches m
    where 'match:' || m.id::text = realtime.topic()
      and auth.uid() in (m.player_one_id, m.player_two_id)
      and m.status <> 'ended'
  )
);
create policy "match participants can send broadcast"
on realtime.messages for insert to authenticated
with check (
  exists (
    select 1 from public.matches m
    where 'match:' || m.id::text = realtime.topic()
      and auth.uid() in (m.player_one_id, m.player_two_id)
      and m.status <> 'ended'
  )
);

-- ========== storage buckets ==========
insert into storage.buckets (id, name, public) values
  ('fighter-originals', 'fighter-originals', false),
  ('fighter-parts', 'fighter-parts', false)
on conflict (id) do nothing;

-- owners manage their own folder ({userId}/...)
create policy "own originals all" on storage.objects
  for all to authenticated
  using (bucket_id = 'fighter-originals' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'fighter-originals' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own parts all" on storage.objects
  for all to authenticated
  using (bucket_id = 'fighter-parts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'fighter-parts' and (storage.foldername(name))[1] = auth.uid()::text);

-- opponents can read parts of fighters in a shared non-ended match
create policy "match opponents read part files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fighter-parts'
    and exists (
      select 1 from public.matches m
      where m.status in ('matched','loading','ready','active')
        and (m.player_one_id = auth.uid() or m.player_two_id = auth.uid())
        and ((storage.foldername(name))[2] = m.player_one_fighter_id
          or (storage.foldername(name))[2] = m.player_two_fighter_id)
    )
  );
