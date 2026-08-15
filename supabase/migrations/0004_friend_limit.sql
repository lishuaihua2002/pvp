-- Friend cap: everyone keeps at most 500 friends; the least active one is dropped first.

alter table public.friendships
  add column if not exists last_interaction_at timestamptz not null default now();
create index if not exists friendships_low_activity_idx
  on public.friendships (user_low_id, last_interaction_at);
create index if not exists friendships_high_activity_idx
  on public.friendships (user_high_id, last_interaction_at);

create or replace function public.friend_limit()
returns int language sql immutable as $$ select 500; $$;

-- keeps the p_user_id side within the cap by deleting the least recently active friendships
create or replace function public.prune_friends(p_user_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_deleted int;
begin
  with mine as (
    select id, last_interaction_at
    from public.friendships
    where p_user_id in (user_low_id, user_high_id)
  ), doomed as (
    select id from mine
    order by last_interaction_at desc, id
    offset public.friend_limit()
  )
  delete from public.friendships f using doomed d where f.id = d.id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

-- bumps the pair's activity so active friends survive pruning
create or replace function public.touch_friendship(a uuid, b uuid)
returns void language sql security definer set search_path = public as $$
  update public.friendships set last_interaction_at = now()
  where user_low_id = least(a, b) and user_high_id = greatest(a, b);
$$;

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
    perform public.prune_friends(v_req.sender_id);
    perform public.prune_friends(v_req.receiver_id);
  else
    update public.friend_requests set status = 'rejected', responded_at = now() where id = p_request_id;
  end if;
end $$;

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
  -- fighting together counts as activity, then trim both sides back to the cap
  perform public.touch_friendship(v_m.player_one_id, v_m.player_two_id);
  perform public.prune_friends(v_m.player_one_id);
  perform public.prune_friends(v_m.player_two_id);
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
  if (select count(*) from public.direct_messages
      where sender_id = v_me and created_at > now() - interval '10 seconds') >= 10 then
    raise exception '发送过于频繁，请稍后再试';
  end if;
  insert into public.direct_messages (sender_id, receiver_id, content, client_message_id)
  values (v_me, p_receiver_id, v_content, p_client_message_id)
  on conflict (sender_id, client_message_id) do nothing
  returning id into v_id;
  perform public.touch_friendship(v_me, p_receiver_id);
  return v_id;
end $$;

-- return type gains last_interaction_at, so the old signature has to go first
drop function if exists public.list_friends();
create function public.list_friends()
returns table (friend_id uuid, username text, display_name text, avatar_url text, source text, created_at timestamptz, last_interaction_at timestamptz)
language sql stable security definer set search_path = public as $$
  select case when f.user_low_id = auth.uid() then f.user_high_id else f.user_low_id end,
         p.username, p.display_name, p.avatar_url, f.source, f.created_at, f.last_interaction_at
  from public.friendships f
  join public.profiles p on p.id = case when f.user_low_id = auth.uid() then f.user_high_id else f.user_low_id end
  where auth.uid() in (f.user_low_id, f.user_high_id)
  order by f.last_interaction_at desc;
$$;

revoke execute on function public.prune_friends(uuid) from anon, authenticated;
revoke execute on function public.touch_friendship(uuid, uuid) from anon, authenticated;
revoke execute on function public.auto_friend_from_match(uuid) from anon;
revoke execute on function public.send_direct_message(uuid, text, text) from anon;
