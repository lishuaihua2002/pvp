-- Harden RPCs: anonymous (未登录) role cannot execute security definer functions
revoke execute on function public.try_matchmake(text) from anon;
revoke execute on function public.mark_match_started(uuid) from anon;
revoke execute on function public.end_match(uuid, text) from anon;
revoke execute on function public.cleanup_stale_matches() from anon;
revoke execute on function public.are_friends(uuid, uuid) from anon;
revoke execute on function public.is_blocked_between(uuid, uuid) from anon;
revoke execute on function public.search_players(text) from anon;
revoke execute on function public.send_friend_request(uuid) from anon;
revoke execute on function public.respond_friend_request(uuid, text) from anon;
revoke execute on function public.remove_friend(uuid) from anon;
revoke execute on function public.block_user(uuid) from anon;
revoke execute on function public.unblock_user(uuid) from anon;
revoke execute on function public.auto_friend_from_match(uuid) from anon;
revoke execute on function public.send_direct_message(uuid, text, text) from anon;
revoke execute on function public.send_fight_invite(uuid) from anon;
revoke execute on function public.respond_fight_invite(uuid, text, text, text) from anon;
revoke execute on function public.list_friends() from anon;
revoke execute on function public.handle_new_user() from anon, authenticated;
