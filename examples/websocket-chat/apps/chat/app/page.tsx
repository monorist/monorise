'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  useEntities,
  useEntity,
  useMutuals,
  createEntity,
  createMutual,
  editMutual,
  useMutualSocket,
  useEphemeralSocket,
  useEntityFeed,
  getWebSocketManager,
} from 'monorise/react';
import { Entity } from '#/monorise/entities';
import GlobalInitializer from '#/components/global-initializer';

export default function ChatPage() {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string>('');
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    null,
  );

  if (!currentUserId) {
    return (
      <>
        <GlobalInitializer />
        <UserSelector
          onSelect={(userId, userName) => {
            setCurrentUserId(userId);
            setCurrentUserName(userName);
          }}
        />
      </>
    );
  }

  return (
    <>
      <GlobalInitializer />
      <ChatApp
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        selectedChannelId={selectedChannelId}
        onSelectChannel={setSelectedChannelId}
      />
    </>
  );
}

function UserSelector({
  onSelect,
}: {
  onSelect: (userId: string, userName: string) => void;
}) {
  const { entities: users, isLoading } = useEntities(Entity.USER);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const { data } = await createEntity(Entity.USER, {
        name: newName.trim(),
        email: `${newName.trim().toLowerCase().replace(/\s+/g, '.')}@demo.local`,
      } as any);
      onSelect(data.entityId, newName.trim());
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-80 space-y-4 rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold">WebSocket Chat Demo</h1>
        <p className="text-sm text-gray-500">Select a user or create a new one</p>

        {isLoading && <div className="text-sm text-gray-400">Loading users...</div>}

        {(users || []).length > 0 && (
          <div className="space-y-1">
            {(users || []).map((user: any) => (
              <button
                key={user.entityId}
                onClick={() => onSelect(user.entityId, user.data.name)}
                className="w-full rounded-md border px-4 py-2 text-left text-sm hover:bg-gray-50"
              >
                {user.data.name}
              </button>
            ))}
          </div>
        )}

        <div className="border-t pt-3">
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Enter your name"
              className="flex-1 rounded-md border px-3 py-2 text-sm"
            />
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {creating ? '...' : 'Join'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatApp({
  currentUserId,
  currentUserName,
  selectedChannelId,
  onSelectChannel,
}: {
  currentUserId: string;
  currentUserName: string;
  selectedChannelId: string | null;
  onSelectChannel: (id: string | null) => void;
}) {
  // Entity feed: real-time updates for all channels this user has joined
  const { isConnected, error } = useEntityFeed({
    entityType: Entity.USER as any,
    entityId: currentUserId,
  });

  // Get channels the user has joined (includes mutualData with lastReadAt)
  const { mutuals: joinedChannels } = useMutuals(
    Entity.USER as any,
    Entity.CHANNEL as any,
    currentUserId,
  );

  const joinedChannelIds = new Set(
    (joinedChannels || []).map((m: any) => m.entityId),
  );

  // Build lastReadAt map from mutual data
  const lastReadAtMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of joinedChannels || []) {
      const mutual = m as any;
      if (mutual.entityId && mutual.mutualData?.lastReadAt) {
        map.set(mutual.entityId, mutual.mutualData.lastReadAt);
      }
    }
    return map;
  }, [joinedChannels]);

  // Track unread counts per channel
  const [unreadCounts, setUnreadCounts] = useState<Map<string, number>>(new Map());
  const selectedChannelRef = useRef(selectedChannelId);
  selectedChannelRef.current = selectedChannelId;

  // Listen for incoming messages to increment unread counts for non-active channels
  useEffect(() => {
    if (!isConnected) return;
    const ws = getWebSocketManager();
    if (!ws) return;

    const handler = (msg: any) => {
      if (msg.type !== 'mutual.created') return;
      const payload = msg.payload as any;
      if (payload.byEntityType !== 'channel' || payload.mutualEntityType !== 'message') return;
      const channelId = payload.byEntityId;
      if (channelId === selectedChannelRef.current) return;
      setUnreadCounts((prev) => {
        const next = new Map(prev);
        next.set(channelId, (next.get(channelId) || 0) + 1);
        return next;
      });
    };

    const unsubscribe = ws.onMessage(handler);
    return () => { unsubscribe?.(); };
  }, [isConnected]);

  // Mark channel as read when selected
  useEffect(() => {
    if (!selectedChannelId || !joinedChannelIds.has(selectedChannelId)) return;
    const now = new Date().toISOString();
    editMutual(
      Entity.USER as any,
      Entity.CHANNEL as any,
      currentUserId,
      selectedChannelId,
      { lastReadAt: now },
    );
    setUnreadCounts((prev) => {
      const next = new Map(prev);
      next.delete(selectedChannelId);
      return next;
    });
  }, [selectedChannelId, currentUserId]);

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="flex w-64 flex-col border-r bg-gray-50">
        <div className="border-b p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-500">Logged in as</div>
              <div className="mt-1 text-sm font-medium">{currentUserName}</div>
            </div>
            <ConnectionIndicator isConnected={isConnected} error={error} />
          </div>
        </div>
        <ChannelList
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          selectedChannelId={selectedChannelId}
          joinedChannelIds={joinedChannelIds}
          lastReadAtMap={lastReadAtMap}
          unreadCounts={unreadCounts}
          onSelectChannel={onSelectChannel}
        />
      </div>

      {/* Main */}
      <div className="flex min-h-0 flex-1 flex-col">
        {selectedChannelId ? (
          <>
            <ChatWindow
              channelId={selectedChannelId}
              currentUserId={currentUserId}
              isJoined={joinedChannelIds.has(selectedChannelId)}
              lastReadAt={lastReadAtMap.get(selectedChannelId) || null}
              onJoin={async () => {
                await createMutual(
                  Entity.USER as any,
                  Entity.CHANNEL as any,
                  currentUserId,
                  selectedChannelId,
                );
              }}
            />
            {joinedChannelIds.has(selectedChannelId) && (
              <MessageInput
                channelId={selectedChannelId}
                currentUserId={currentUserId}
                currentUserName={currentUserName}
              />
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-gray-400">
            Select a channel to start chatting
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectionIndicator({
  isConnected,
  error,
}: {
  isConnected: boolean;
  error: { code: string; message: string } | null;
}) {
  return (
    <div className="flex items-center gap-1" title={error?.message || (isConnected ? 'Connected' : 'Disconnected')}>
      <div
        className={`h-2 w-2 rounded-full ${
          error
            ? 'bg-red-500'
            : isConnected
              ? 'bg-green-500'
              : 'bg-yellow-500 animate-pulse'
        }`}
      />
      <span className="text-xs text-gray-400">
        {error ? 'Error' : isConnected ? 'Live' : 'Connecting'}
      </span>
    </div>
  );
}

function ChannelList({
  currentUserId,
  currentUserName,
  selectedChannelId,
  joinedChannelIds,
  lastReadAtMap,
  unreadCounts,
  onSelectChannel,
}: {
  currentUserId: string;
  currentUserName: string;
  selectedChannelId: string | null;
  joinedChannelIds: Set<string>;
  lastReadAtMap: Map<string, string>;
  unreadCounts: Map<string, number>;
  onSelectChannel: (id: string) => void;
}) {
  const { entities: allChannels, isLoading } = useEntities(Entity.CHANNEL);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const joined = (allChannels || []).filter((ch: any) => joinedChannelIds.has(ch.entityId));
  const notJoined = (allChannels || []).filter((ch: any) => !joinedChannelIds.has(ch.entityId));

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createEntity(Entity.CHANNEL, {
      name: newName.trim(),
      description: `Created by ${currentUserName}`,
      createdBy: currentUserId,
    } as any);
    setNewName('');
    setCreating(false);
  };

  const ChannelButton = ({ ch }: { ch: any }) => {
    const count = unreadCounts.get(ch.entityId) || 0;
    const hasUnread = count > 0;
    return (
      <button
        key={ch.entityId}
        onClick={() => onSelectChannel(ch.entityId)}
        className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
          selectedChannelId === ch.entityId
            ? 'bg-blue-50 text-blue-700'
            : 'hover:bg-gray-100'
        }`}
      >
        <span className={hasUnread ? 'font-bold' : ''}>
          # {ch.data.name}
        </span>
        {hasUnread && (
          <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-xs text-white">
            {count}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="p-3 text-sm text-gray-400">Loading...</div>
        )}

        {/* Joined channels */}
        {joined.length > 0 && (
          <div>
            <div className="px-3 py-2 text-xs font-semibold uppercase text-gray-400">
              Joined
            </div>
            {joined.map((ch: any) => (
              <ChannelButton key={ch.entityId} ch={ch} />
            ))}
          </div>
        )}

        {/* Not joined channels */}
        {notJoined.length > 0 && (
          <div>
            <div className="px-3 py-2 text-xs font-semibold uppercase text-gray-400">
              Browse
            </div>
            {notJoined.map((ch: any) => (
              <ChannelButton key={ch.entityId} ch={ch} />
            ))}
          </div>
        )}
      </div>

      {creating ? (
        <div className="border-t p-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Channel name"
            className="w-full rounded border px-2 py-1 text-sm"
          />
          <div className="mt-1 flex gap-1">
            <button
              onClick={handleCreate}
              className="rounded bg-blue-600 px-2 py-1 text-xs text-white"
            >
              Create
            </button>
            <button
              onClick={() => setCreating(false)}
              className="rounded border px-2 py-1 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="border-t px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-100"
        >
          + Add Channel
        </button>
      )}
    </div>
  );
}

function ChatWindow({
  channelId,
  currentUserId,
  isJoined,
  lastReadAt,
  onJoin,
}: {
  channelId: string;
  currentUserId: string;
  isJoined: boolean;
  lastReadAt: string | null;
  onJoin: () => Promise<void>;
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [joining, setJoining] = useState(false);
  const { entity: channel } = useEntity(Entity.CHANNEL, channelId);
  const { mutuals: messages, isLoading } = useMutuals(
    Entity.CHANNEL as any,
    Entity.MESSAGE as any,
    channelId,
    { limit: 50 } as any,
  );

  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(
    new Map(),
  );

  useEphemeralSocket<{
    type: 'typing' | 'stopped';
    userId: string;
    userName: string;
  }>(`channel:${channelId}:typing`, {
    onMessage: (data) => {
      if (data.userId === currentUserId) return;
      if (data.type === 'typing') {
        setTypingUsers((prev) => new Map(prev).set(data.userId, data.userName));
        setTimeout(() => {
          setTypingUsers((prev) => {
            const next = new Map(prev);
            next.delete(data.userId);
            return next;
          });
        }, 3000);
      } else {
        setTypingUsers((prev) => {
          const next = new Map(prev);
          next.delete(data.userId);
          return next;
        });
      }
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const typingNames = Array.from(typingUsers.values());
  const typingText =
    typingNames.length === 1
      ? `${typingNames[0]} is typing...`
      : typingNames.length > 1
        ? `${typingNames[0]} and ${typingNames.length - 1} others are typing...`
        : null;

  const sortedMessages = [...(messages || [])].sort((a: any, b: any) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const handleJoin = async () => {
    setJoining(true);
    try {
      await onJoin();
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <div>
          <div className="font-semibold">
            # {channel?.data?.name || 'Loading...'}
          </div>
          <div className="text-xs text-gray-400">
            {channel?.data?.description}
          </div>
        </div>
        {!isJoined && (
          <button
            onClick={handleJoin}
            disabled={joining}
            className="rounded-md bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            {joining ? 'Joining...' : 'Join Channel'}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {isLoading && <div className="text-sm text-gray-400">Loading messages...</div>}
        {sortedMessages.length === 0 && !isLoading && (
          <div className="text-sm text-gray-400">
            No messages yet. {isJoined ? 'Start the conversation!' : 'Join to start chatting.'}
          </div>
        )}
        {(() => {
          const lastReadTime = lastReadAt ? new Date(lastReadAt).getTime() : null;
          let newDividerShown = false;
          return sortedMessages.map((m: any) => {
          const isMe = m.data?.authorId === currentUserId;
          const msgTime = m.createdAt ? new Date(m.createdAt).getTime() : 0;
          const showNewDivider = !newDividerShown && !isMe && lastReadTime && msgTime > lastReadTime;
          if (showNewDivider) newDividerShown = true;

          return (
            <div key={m.entityId}>
              {showNewDivider && (
                <div className="my-3 flex items-center gap-2">
                  <div className="flex-1 border-t border-red-400" />
                  <span className="text-xs font-semibold text-red-500">New</span>
                  <div className="flex-1 border-t border-red-400" />
                </div>
              )}
              <div className={`mb-3 flex ${isMe ? 'justify-end' : ''}`}>
              <div
                className={`max-w-md rounded-lg px-3 py-2 ${
                  isMe ? 'bg-blue-600 text-white' : 'bg-gray-100'
                }`}
              >
                {!isMe && (
                  <div className="text-xs font-semibold text-gray-600">
                    {m.data?.authorName}
                  </div>
                )}
                <div className="text-sm">{m.data?.content}</div>
                <div
                  className={`mt-1 text-right text-xs ${
                    isMe ? 'text-blue-200' : 'text-gray-400'
                  }`}
                >
                  {m.createdAt
                    ? new Date(m.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : ''}
                </div>
              </div>
            </div>
            </div>
          );
        });
        })()}
        <div ref={messagesEndRef} />
      </div>
      {!isJoined && (
        <div className="border-t bg-gray-50 p-3 text-center text-sm text-gray-500">
          Join this channel to send messages
        </div>
      )}
      {typingText && (
        <div className="px-4 py-1 text-xs text-gray-400">{typingText}</div>
      )}
    </div>
  );
}

function MessageInput({
  channelId,
  currentUserId,
  currentUserName,
}: {
  channelId: string;
  currentUserId: string;
  currentUserName: string;
}) {
  const [message, setMessage] = useState('');
  const typingRef = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { send } = useEphemeralSocket<{
    type: 'typing' | 'stopped';
    userId: string;
    userName: string;
  }>(`channel:${channelId}:typing`);

  const sendTyping = (type: 'typing' | 'stopped') => {
    send({ type, userId: currentUserId, userName: currentUserName });
  };

  const handleChange = (value: string) => {
    setMessage(value);
    if (!typingRef.current && value.trim()) {
      typingRef.current = true;
      sendTyping('typing');
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (typingRef.current) {
        typingRef.current = false;
        sendTyping('stopped');
      }
    }, 2000);
  };

  const handleSend = async () => {
    if (!message.trim()) return;
    if (typingRef.current) {
      typingRef.current = false;
      sendTyping('stopped');
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    await createEntity(Entity.MESSAGE, {
      content: message.trim(),
      channelId,
      authorId: currentUserId,
      authorName: currentUserName,
      channelIds: [channelId],
    } as any);

    setMessage('');
  };

  return (
    <div className="border-t p-3">
      <div className="flex gap-2">
        <input
          value={message}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={`Message as ${currentUserName}...`}
          className="flex-1 rounded-md border px-3 py-2 text-sm"
        />
        <button
          onClick={handleSend}
          disabled={!message.trim()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
