import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase/client'
import { playSfx } from '../game/audio/sfx'

interface FriendRow {
  friend_id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  source: string
  created_at: string
}

interface SearchRow {
  id: string
  username: string | null
  display_name: string | null
  is_friend: boolean
}

interface RequestRow {
  id: string
  sender_id: string
  profiles?: { username: string | null; display_name: string | null } | null
}

interface Message {
  id: string
  sender_id: string
  receiver_id: string
  content: string
  created_at: string
}

export default function FriendsPanel({ userId }: { userId: string }) {
  const [tab, setTab] = useState<'friends' | 'search' | 'requests'>('friends')
  const [friends, setFriends] = useState<FriendRow[]>([])
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchRow[]>([])
  const [chatWith, setChatWith] = useState<FriendRow | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [info, setInfo] = useState<string | null>(null)
  const chatBottomRef = useRef<HTMLDivElement>(null)

  const loadFriends = useCallback(async () => {
    const { data } = await supabase.rpc('list_friends')
    setFriends((data as FriendRow[]) ?? [])
  }, [])

  const loadRequests = useCallback(async () => {
    const { data } = await supabase
      .from('friend_requests')
      .select('id, sender_id, profiles!friend_requests_sender_id_fkey(username, display_name)')
      .eq('receiver_id', userId)
      .eq('status', 'pending')
    setRequests((data as unknown as RequestRow[]) ?? [])
  }, [userId])

  useEffect(() => {
    void loadFriends()
    void loadRequests()
  }, [loadFriends, loadRequests])

  // realtime incoming messages for open chat
  useEffect(() => {
    if (!chatWith) return
    const load = async () => {
      const { data } = await supabase
        .from('direct_messages')
        .select('id, sender_id, receiver_id, content, created_at')
        .or(
          `and(sender_id.eq.${userId},receiver_id.eq.${chatWith.friend_id}),and(sender_id.eq.${chatWith.friend_id},receiver_id.eq.${userId})`,
        )
        .order('created_at', { ascending: true })
        .limit(100)
      setMessages((data as Message[]) ?? [])
    }
    void load()
    const timer = setInterval(() => void load(), 3000)
    return () => clearInterval(timer)
  }, [chatWith, userId])

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const search = async () => {
    const { data, error } = await supabase.rpc('search_players', { p_query: query })
    if (error) setInfo(error.message)
    else setResults((data as SearchRow[]) ?? [])
  }

  const sendRequest = async (targetId: string) => {
    playSfx('click')
    const { error } = await supabase.rpc('send_friend_request', { p_receiver_id: targetId })
    setInfo(error ? error.message : 'Friend request sent')
  }

  const respond = async (requestId: string, action: 'accept' | 'reject') => {
    playSfx('click')
    await supabase.rpc('respond_friend_request', { p_request_id: requestId, p_action: action })
    await Promise.all([loadFriends(), loadRequests()])
  }

  const sendMessage = async () => {
    const content = draft.trim()
    if (!content || !chatWith) return
    setDraft('')
    const { error } = await supabase.rpc('send_direct_message', {
      p_receiver_id: chatWith.friend_id,
      p_content: content,
      p_client_message_id: crypto.randomUUID(),
    })
    if (error) setInfo(error.message)
  }

  if (chatWith) {
    return (
      <div className="panel flex max-h-96 flex-col">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-bold text-arcade-cyan">
            💬 {chatWith.display_name || chatWith.username}
          </div>
          <button className="text-sm text-gray-400 hover:text-white" onClick={() => setChatWith(null)}>
            ← Back
          </button>
        </div>
        <div className="flex-1 overflow-y-auto rounded bg-black/30 p-2 text-sm">
          {messages.map((m) => (
            <div key={m.id} className={`mb-1 flex ${m.sender_id === userId ? 'justify-end' : 'justify-start'}`}>
              <span
                className={`max-w-[80%] break-words rounded-lg px-2 py-1 ${
                  m.sender_id === userId ? 'bg-arcade-accent/30' : 'bg-arcade-border'
                }`}
              >
                {m.content}
              </span>
            </div>
          ))}
          {messages.length === 0 && <div className="text-gray-500">Say hi!</div>}
          <div ref={chatBottomRef} />
        </div>
        <div className="mt-2 flex gap-2">
          <input
            className="input flex-1"
            maxLength={500}
            placeholder="Type a message..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void sendMessage()}
          />
          <button className="btn-primary" onClick={() => void sendMessage()}>
            Send
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="mb-3 grid grid-cols-3 gap-2 text-sm">
        {(
          [
            ['friends', `Friends ${friends.length}`],
            ['search', 'Search'],
            ['requests', `Requests ${requests.length}`],
          ] as const
        ).map(([t, label]) => (
          <button key={t} className={tab === t ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {info && (
        <div className="mb-2 rounded bg-arcade-border/60 p-2 text-xs text-gray-300" onClick={() => setInfo(null)}>
          {info}
        </div>
      )}

      {tab === 'friends' && (
        <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
          {friends.map((f) => (
            <div key={f.friend_id} className="flex items-center justify-between rounded bg-black/30 p-2">
              <div>
                <div className="text-sm font-bold">{f.display_name || f.username}</div>
                <div className="text-xs text-gray-500">{f.source === 'match_auto' ? '⚔️ Met in battle' : 'Added manually'}</div>
              </div>
              <button className="btn-secondary text-xs" onClick={() => setChatWith(f)}>
                Chat
              </button>
            </div>
          ))}
          {friends.length === 0 && <div className="text-sm text-gray-500">No friends yet. Fight someone for over a minute to become friends automatically!</div>}
        </div>
      )}

      {tab === 'search' && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="Search by username"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void search()}
            />
            <button className="btn-secondary" onClick={() => void search()}>
              Search
            </button>
          </div>
          {results.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded bg-black/30 p-2">
              <div className="text-sm">{r.display_name || r.username}</div>
              {r.is_friend ? (
                <span className="text-xs text-gray-500">Already friends</span>
              ) : (
                <button className="btn-secondary text-xs" onClick={() => void sendRequest(r.id)}>
                  Add friend
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'requests' && (
        <div className="flex flex-col gap-2">
          {requests.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded bg-black/30 p-2">
              <div className="text-sm">{r.profiles?.display_name || r.profiles?.username || 'Player'}</div>
              <div className="flex gap-2">
                <button className="btn-primary text-xs" onClick={() => void respond(r.id, 'accept')}>
                  Accept
                </button>
                <button className="btn-warn text-xs" onClick={() => void respond(r.id, 'reject')}>
                  Decline
                </button>
              </div>
            </div>
          ))}
          {requests.length === 0 && <div className="text-sm text-gray-500">No pending requests</div>}
        </div>
      )}
    </div>
  )
}
