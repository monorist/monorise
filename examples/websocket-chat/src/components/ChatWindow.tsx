import { useEffect, useRef } from 'react'
import Monorise, { 
  useMutualSocket,
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

export function ChatWindow({ channelId, currentUserId }: ChatWindowProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  const { entity: channel } = Monorise.useEntity('channel', channelId)
  
  // Hook handles initial fetch + WebSocket subscription
  const { 
    mutuals: messages, 
    isLoading, 
    isSubscribed,
    fetchMore 
  } = useMutualSocket('channel', channelId, 'message', { limit: 30 })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }

  const isCurrentUser = (authorId: string) => authorId === currentUserId

  return (
    <div className="chat-window">
      <div className="chat-header">
        <h2># {channel?.data.name || 'Loading...'}</h2>
        <span className="channel-description">
          {channel?.data.description}
          {isSubscribed && ' • Live'}
        </span>
      </div>
      
      <div className="messages">
        {isLoading && (
          <div className="loading-messages">Loading messages...</div>
        )}
        
        {!isLoading && messages.size > 0 && (
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
    </div>
  )
}
