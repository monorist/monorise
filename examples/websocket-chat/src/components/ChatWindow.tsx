import { useEffect, useRef, useState } from 'react'
import Monorise, { 
  useMutualSocket,
  useEphemeralSocket,
} from '@monorise/react'

interface ChatWindowProps {
  channelId: string
  currentUserId: string
}

interface Message {
  entityId: string
  data: {
    content: string
    channelId: string
    authorId: string
    authorName: string
  }
  createdAt: string
}

interface TypingEvent {
  type: 'typing' | 'stopped'
  userId: string
  userName: string
  channelId: string
}

export function ChatWindow({ channelId, currentUserId }: ChatWindowProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [typingUsers, setTypingUsers] = useState<Map<string, { name: string; timeout: NodeJS.Timeout }>>(new Map())
  
  const { entity: channel } = Monorise.useEntity('channel', channelId)
  
  // Hook handles: initial fetch + real-time updates + auto-refetch on reconnect
  const { 
    mutuals: messages, 
    isLoading, 
    isRefreshing,
    isSubscribed,
    fetchMore,
    hasMore
  } = useMutualSocket('channel', channelId, 'message', { limit: 30 })

  // Listen for typing indicators
  useEphemeralSocket<TypingEvent>(`channel:${channelId}:typing`, {
    onMessage: (data) => {
      // Don't show typing indicator for current user
      if (data.userId === currentUserId) return
      
      if (data.type === 'typing') {
        setTypingUsers(prev => {
          const next = new Map(prev)
          // Clear existing timeout if any
          const existing = next.get(data.userId)
          if (existing?.timeout) {
            clearTimeout(existing.timeout)
          }
          // Set new timeout to remove typing indicator after 3 seconds
          const timeout = setTimeout(() => {
            setTypingUsers(p => {
              const n = new Map(p)
              n.delete(data.userId)
              return n
            })
          }, 3000)
          next.set(data.userId, { name: data.userName, timeout })
          return next
        })
      } else if (data.type === 'stopped') {
        setTypingUsers(prev => {
          const next = new Map(prev)
          const existing = next.get(data.userId)
          if (existing?.timeout) {
            clearTimeout(existing.timeout)
          }
          next.delete(data.userId)
          return next
        })
      }
    }
  })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      typingUsers.forEach(({ timeout }) => clearTimeout(timeout))
    }
  }, [])

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }

  const isCurrentUser = (authorId: string) => authorId === currentUserId

  // Format typing indicator text
  const getTypingText = () => {
    const users = Array.from(typingUsers.values())
    if (users.length === 0) return null
    if (users.length === 1) return `${users[0].name} is typing...`
    if (users.length === 2) return `${users[0].name} and ${users[1].name} are typing...`
    return `${users[0].name} and ${users.length - 1} others are typing...`
  }

  const typingText = getTypingText()

  return (
    <div className="chat-window">
      <div className="chat-header">
        <h2># {channel?.data.name || 'Loading...'}</h2>
        <span className="channel-description">
          {channel?.data.description}
          {isSubscribed && ' • live'}
          {isRefreshing && ' (syncing...) '}
        </span>
      </div>
      
      <div className="messages">
        {isLoading && (
          <div className="loading-messages">Loading messages...</div>
        )}
        
        {!isLoading && hasMore && (
          <button className="load-more-btn" onClick={fetchMore}>
            Load More Messages
          </button>
        )}
        
        {messages?.size === 0 && !isLoading && (
          <div className="no-messages">
            No messages yet. Start the conversation!
          </div>
        )}
        
        {Array.from(messages?.values() || []).map((mutual: any) => {
          const message = mutual as Message
          const isMe = isCurrentUser(message.data.authorId)
          
          return (
            <div 
              key={message.entityId} 
              className={`message ${isMe ? 'own-message' : ''}`}
            >
              <div className="message-avatar">
                {message.data.authorName.charAt(0).toUpperCase()}
              </div>
              <div className="message-content">
                <div className="message-header">
                  <span className="message-author">{message.data.authorName}</span>
                  <span className="message-time">{formatTime(message.createdAt)}</span>
                </div>
                <div className="message-text">{message.data.content}</div>
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {typingText && (
        <div className="typing-indicator">
          <span className="typing-dots">
            <span></span>
            <span></span>
            <span></span>
          </span>
          <span className="typing-text">{typingText}</span>
        </div>
      )}
    </div>
  )
}
