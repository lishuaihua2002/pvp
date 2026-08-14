-- Friends, direct messages, blocks, fight invites

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending', -- pending | accepted | rejected
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (sender_id <> receiver_id)
);
create unique index one_pending_request_per_pair on public.friend_requests
  (least(sender_id, receiver_id), greatest(sender_id, receiver_id))
  where status = 'pending';

alter table public.friend_requests enable row level security;
create policy "own requests read" on public.friend_requests
  for select to authenticated using (auth.uid() in (sender_id, receiver_id));

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_low_id uuid not null references public.profiles(id) on delete cascade,
  user_high_id uuid not null references public.profiles(id) on delete cascade,
  source text not null default 'manual_request', -- manual_request | match_auto | admin
  source_match_id uuid references public.matches(id) on delete set null,
  created_at timestamptz not null default now(),
  check (user_low_id < user_high_id),
  unique (user_low_id, user_high_id)
);
alter table public.friendships enable row level security;
create policy "own friendships read" on public.friendships
  for select to authenticated using (auth.uid() in (user_low_id, user_high_id));

create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.user_blocks enable row level security;
create policy "own blocks all" on public.user_blocks
  for all to authenticated using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

create table public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 500),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  client_message_id text,
  unique (sender_id, client_message_id)
);
create index dm_pair_idx on public.direct_messages
  (least(sender_id, receiver_id), greatest(sender_id, receiver_id), created_at desc);

alter table public.direct_messages enable row level security;
create policy "own dms read" on public.direct_messages
  for select to authenticated using (auth.uid() in (sender_id, receiver_id));
create policy "receiver can mark read" on public.direct_messages
  for update to authenticated using (auth.uid() = receiver_id) with check (auth.uid() = receiver_id);

create table public.fight_invites (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending', -- pending | accepted | rejected | expired | cancelled
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 seconds',
  match_id uuid references public.matches(id) on delete set null,
  check (sender_id <> receiver_id)
);
alter table public.fight_invites enable row level security;
create policy "own invites read" on public.fight_invites
  for select to authenticated using (auth.uid() in (sender_id, receiver_id));

-- helpers
create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships
    where user_low_id = least(a, b) and user_high_id = greatest(a, b)
  );
$$;

create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

-- ========== RPCs ==========
create or replace function public.search_players(p_query text)
returns table (id uuid, username text, display_name text, avatar_url text, is_friend boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if char_length(trim(p_query)) < 2 then return; end if;
  return query
    select p.id, p.username, p.display_name, p.avatar_url,
           public.are_friends(auth.uid(), p.id)
    from public.profiles p
    where p.id <> auth.uid()
      and p.username is not null
      and (lower(p.username) = lower(trim(p_query)) or lower(p.username) like lower(trim(p_query)) || '%')
      and not exists (select 1 from public.user_blocks ub where ub.blocker_id = p.id and ub.blocked_id = auth.uid())
    limit 20;
end $$;

create or replace function public.send_friend_request(p_receiver_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_reverse public.friend_requests;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_receiver_id = v_me then raise exception '不能添加自己为好友'; end if;
  if public.is_blocked_between(v_me, p_receiver_id) then raise exception '无法向该用户发送申请'; end if;
  if public.are_friends(v_me, p_receiver_id) then raise exception '你们已经是好友'; end if;
  if not exists (select 1 from public.player_settings s where s.user_id = p_receiver_id and s.allow_friend_requests) then
    raise exception '对方不接受好友申请';
  end if;

  -- if reverse pending request exists, accept it instead
  select * into v_reverse from public.friend_requests
    where sender_id = p_receiver_id and receiver_id = v_me and status = 'pending';
  if found then
    perform public.respond_friend_request(v_reverse.id, 'accept');
    return v_reverse.id;
  end if;

  insert into public.friend_requests (sender_id, receiver_id)
  values (v_me, p_receiver_id)
  on conflict do nothing
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.respond_friend_request(p_request_id uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req public.friend_requests;
begin
  select * into v_req from public.friend_requests where id = p_request_id for update;
  if not found or v_req.receiver_id <> auth.uid() or v_req.status <> 'pending' then
    raise exception '无效的好友申请';
  end if;
  if p_action = 'accept' then
    update public.friend_requests set status = 'accepted', responded_at = now() where id = p_request_id;
    insert into public.friendships (user_low_id, user_high_id, source)
    values (least(v_req.sender_id, v_req.receiver_id), greatest(v_req.sender_id, v_req.receiver_id), 'manual_request')
    on conflict do nothing;
  else
    update public.friend_requests set status = 'rejected', responded_at = now() where id = p_request_id;
  end if;
end $$;

create or replace function public.remove_friend(p_friend_id uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.friendships
  where user_low_id = least(auth.uid(), p_friend_id)
    and user_high_id = greatest(auth.uid(), p_friend_id);
$$;

create or replace function public.block_user(p_target_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_target_id = auth.uid() then raise exception '不能屏蔽自己'; end if;
  insert into public.user_blocks (blocker_id, blocked_id) values (auth.uid(), p_target_id)
  on conflict do nothing;
  perform public.remove_friend(p_target_id);
  update public.friend_requests set status = 'rejected', responded_at = now()
    where status = 'pending' and ((sender_id = auth.uid() and receiver_id = p_target_id) or (sender_id = p_target_id and receiver_id = auth.uid()));
end $$;

create or replace function public.unblock_user(p_target_id uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.user_blocks where blocker_id = auth.uid() and blocked_id = p_target_id;
$$;

-- auto friend after 60s of active fighting; server-side verified & idempotent
create or replace function public.auto_friend_from_match(p_match_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_m public.matches;
  v_created boolean := false;
begin
  select * into v_m from public.matches where id = p_match_id for update;
  if not found then return false; end if;
  if auth.uid() not in (v_m.player_one_id, v_m.player_two_id) then
    raise exception 'not a participant';
  end if;
  if v_m.started_at is null or now() - v_m.started_at < interval '60 seconds' then
    return false;
  end if;
  if v_m.status not in ('active', 'ended') then return false; end if;
  if v_m.auto_friend_processed_at is not null then return false; end if;
  if public.is_blocked_between(v_m.player_one_id, v_m.player_two_id) then return false; end if;
  -- both players must allow auto friending
  if exists (
    select 1 from public.player_settings s
    where s.user_id in (v_m.player_one_id, v_m.player_two_id) and not s.auto_friend_after_match
  ) then
    return false;
  end if;

  update public.matches set auto_friend_processed_at = now() where id = p_match_id;

  if not public.are_friends(v_m.player_one_id, v_m.player_two_id) then
    insert into public.friendships (user_low_id, user_high_id, source, source_match_id)
    values (least(v_m.player_one_id, v_m.player_two_id), greatest(v_m.player_one_id, v_m.player_two_id), 'match_auto', p_match_id)
    on conflict do nothing;
    v_created := true;
  end if;
  update public.friend_requests set status = 'accepted', responded_at = now()
    where status = 'pending'
      and least(sender_id, receiver_id) = least(v_m.player_one_id, v_m.player_two_id)
      and greatest(sender_id, receiver_id) = greatest(v_m.player_one_id, v_m.player_two_id);
  return v_created;
end $$;

create or replace function public.send_direct_message(p_receiver_id uuid, p_content text, p_client_message_id text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_content text := trim(p_content);
  v_id uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if char_length(v_content) = 0 then raise exception '消息不能为空'; end if;
  if char_length(v_content) > 500 then raise exception '消息过长'; end if;
  if not public.are_friends(v_me, p_receiver_id) then raise exception '只能给好友发送消息'; end if;
  if public.is_blocked_between(v_me, p_receiver_id) then raise exception '无法发送消息'; end if;
  -- basic rate limit: max 10 messages in 10 seconds
  if (select count(*) from public.direct_messages
      where sender_id = v_me and created_at > now() - interval '10 seconds') >= 10 then
    raise exception '发送过于频繁，请稍后再试';
  end if;
  insert into public.direct_messages (sender_id, receiver_id, content, client_message_id)
  values (v_me, p_receiver_id, v_content, p_client_message_id)
  on conflict (sender_id, client_message_id) do nothing
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.send_fight_invite(p_receiver_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if not public.are_friends(v_me, p_receiver_id) then raise exception '只能邀请好友对战'; end if;
  if public.is_blocked_between(v_me, p_receiver_id) then raise exception '无法邀请该用户'; end if;
  if not exists (select 1 from public.player_settings s where s.user_id = p_receiver_id and s.allow_fight_invites) then
    raise exception '对方不接受对战邀请';
  end if;
  if exists (select 1 from public.matches m where m.status in ('matched','loading','ready','active')
             and (v_me in (m.player_one_id, m.player_two_id) or p_receiver_id in (m.player_one_id, m.player_two_id))) then
    raise exception '你或对方正在对战中';
  end if;
  update public.fight_invites set status = 'expired' where status = 'pending' and expires_at < now();
  if exists (select 1 from public.fight_invites where status = 'pending'
             and sender_id = v_me and receiver_id = p_receiver_id) then
    raise exception '已发送过邀请，请等待回应';
  end if;
  insert into public.fight_invites (sender_id, receiver_id) values (v_me, p_receiver_id)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.respond_fight_invite(p_invite_id uuid, p_action text, p_my_fighter_id text, p_sender_fighter_id text)
returns setof public.matches language plpgsql security definer set search_path = public as $$
declare
  v_inv public.fight_invites;
  v_match public.matches;
begin
  select * into v_inv from public.fight_invites where id = p_invite_id for update;
  if not found or v_inv.receiver_id <> auth.uid() or v_inv.status <> 'pending' then
    raise exception '无效邀请';
  end if;
  if v_inv.expires_at < now() then
    update public.fight_invites set status = 'expired' where id = p_invite_id;
    raise exception '邀请已过期';
  end if;
  if p_action <> 'accept' then
    update public.fight_invites set status = 'rejected' where id = p_invite_id;
    return;
  end if;
  insert into public.matches (player_one_id, player_two_id, player_one_fighter_id, player_two_fighter_id, host_player_id, status)
  values (v_inv.sender_id, v_inv.receiver_id, p_sender_fighter_id, p_my_fighter_id, v_inv.sender_id, 'matched')
  returning * into v_match;
  insert into public.match_players (match_id, player_id, fighter_id, joined_at)
  values (v_match.id, v_inv.sender_id, p_sender_fighter_id, now()),
         (v_match.id, v_inv.receiver_id, p_my_fighter_id, now());
  update public.fight_invites set status = 'accepted', match_id = v_match.id where id = p_invite_id;
  return next v_match;
end $$;

create or replace function public.list_friends()
returns table (friend_id uuid, username text, display_name text, avatar_url text, source text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select case when f.user_low_id = auth.uid() then f.user_high_id else f.user_low_id end,
         p.username, p.display_name, p.avatar_url, f.source, f.created_at
  from public.friendships f
  join public.profiles p on p.id = case when f.user_low_id = auth.uid() then f.user_high_id else f.user_low_id end
  where auth.uid() in (f.user_low_id, f.user_high_id)
  order by f.created_at desc;
$$;
