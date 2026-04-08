'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  useEntities,
  useEntity,
  useMutuals,
  createEntity,
  initializeWebSocketManager,
  WebSocketManager,
  useMutualSocket,
  useEntitySocket,
  useEphemeralSocket,
} from 'monorise/react';
import { Entity } from '#/monorise/entities';
import GlobalInitializer from '#/components/global-initializer';

const DEMO_USERS = [
  { userId: 'user-1', name: 'Alice Johnson' },
  { userId: 'user-2', name: 'Bob Smith' },
  { userId: 'user-3', name: 'Charlie Brown' },
  { userId: 'user-4', name: 'Diana Prince' },
];

export default function ChatPage() {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    null,
  );

  const handleUserSelect = useCallback((userId: string) => {
    setCurrentUserId(userId);
    let wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'wss://tpnmh97fna.execute-api.ap-southeast-1.amazonaws.com/$default';
    console.log('WebSocket URL:', wsUrl);
    if (wsUrl) {
      initializeWebSocketManager(
        WebSocketManager,
        wsUrl,
        userId,
      );
    } else {
      console.warn('NEXT_PUBLIC_WS_URL not set — WebSocket disabled');
    }
  }, []);

  if (!currentUserId) {
    return (
      <>
        <GlobalInitializer />
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <div className="w-80 space-y-4 rounded-lg border bg-white p-6 shadow-sm">
            <h1 className="text-xl font-bold">WebSocket Chat Demo</h1>
            <p className="text-sm text-gray-500">Select a user to start chatting</p>
            <div className="space-y-2">
              {DEMO_USERS.map((user) => (
                <button
                  key={user.userId}
                  onClick={() => handleUserSelect(user.userId)}
                  className="w-full rounded-md border px-4 py-2 text-left text-sm hover:bg-gray-50"
                >
                  {user.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <GlobalInitializer />
      <div className="flex h-screen">
        {/* Sidebar */}
        <div className="flex w-64 flex-col border-r bg-gray-50">
          <div className="border-b p-3">
            <div className="text-xs text-gray-500">Logged in as</div>
            <select
              value={currentUserId}
              onChange={(e) => handleUserSelect(e.target.value)}
              className="mt-1 w-full rounded border bg-white px-2 py-1 text-sm"
            >
              {DEMO_USERS.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <ChannelList
            currentUserId={currentUserId}
            selectedChannelId={selectedChannelId}
            onSelectChannel={setSelectedChannelId}
          />
        </div>

        {/* Main */}
        <div className="flex min-h-0 flex-1 flex-col">
          {selectedChannelId ? (
            <>
              <ChatWindow
                channelId={selectedChannelId}
                currentUserId={currentUserId}
              />
              <MessageInput
                channelId={selectedChannelId}
                currentUserId={currentUserId}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-gray-400">
              Select a channel to start chatting
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ChannelList({
  currentUserId,
  selectedChannelId,
  onSelectChannel,
}: {
  currentUserId: string;
  selectedChannelId: string | null;
  onSelectChannel: (id: string) => void;
}) {
  const { entities: channels, isLoading } = useEntitySocket(Entity.CHANNEL);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const user = DEMO_USERS.find((u) => u.userId === currentUserId);
    await createEntity(Entity.CHANNEL, {
      name: newName.trim(),
      description: `Created by ${user?.name}`,
      createdBy: currentUserId,
    } as any);
    setNewName('');
    setCreating(false);
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-semibold">Channels</span>
      </div>
      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="p-3 text-sm text-gray-400">Loading...</div>
        )}
        {channels?.map((ch: any) => (
          <button
            key={ch.entityId}
            onClick={() => onSelectChannel(ch.entityId)}
            className={`w-full px-3 py-2 text-left text-sm ${
              selectedChannelId === ch.entityId
                ? 'bg-blue-50 text-blue-700'
                : 'hover:bg-gray-100'
            }`}
          >
            # {ch.data.name}
          </button>
        ))}
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
}: {
  channelId: string;
  currentUserId: string;
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { entity: channel } = useEntity(Entity.CHANNEL, channelId);
  const { mutuals: messages, isLoading } = useMutualSocket(
    Entity.CHANNEL,
    channelId,
    Entity.MESSAGE,
    { limit: 50 },
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b px-4 py-3">
        <div className="font-semibold">
          # {channel?.data?.name || 'Loading...'}
        </div>
        <div className="text-xs text-gray-400">
          {channel?.data?.description}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {isLoading && <div className="text-sm text-gray-400">Loading messages...</div>}
        {messages?.length === 0 && !isLoading && (
          <div className="text-sm text-gray-400">
            No messages yet. Start the conversation!
          </div>
        )}
        {[...(messages || [])].sort((a: any, b: any) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        ).map((m: any) => {
          const isMe = m.data?.authorId === currentUserId;
          return (
            <div key={m.entityId} className={`mb-3 flex ${isMe ? 'justify-end' : ''}`}>
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
                  {new Date(m.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
      {typingText && (
        <div className="px-4 py-1 text-xs text-gray-400">{typingText}</div>
      )}
    </div>
  );
}

function MessageInput({
  channelId,
  currentUserId,
}: {
  channelId: string;
  currentUserId: string;
}) {
  const [message, setMessage] = useState('');
  const typingRef = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const user = DEMO_USERS.find((u) => u.userId === currentUserId);

  const { send } = useEphemeralSocket<{
    type: 'typing' | 'stopped';
    userId: string;
    userName: string;
  }>(`channel:${channelId}:typing`);

  const sendTyping = (type: 'typing' | 'stopped') => {
    if (!user) return;
    send({ type, userId: currentUserId, userName: user.name });
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
    if (!message.trim() || !user) return;
    if (typingRef.current) {
      typingRef.current = false;
      sendTyping('stopped');
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    await createEntity(Entity.MESSAGE, {
      content: message.trim(),
      channelId,
      authorId: currentUserId,
      authorName: user.name,
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
          placeholder={`Message as ${user?.name}...`}
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
