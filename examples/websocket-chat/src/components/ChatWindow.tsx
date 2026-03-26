import { useEffect, useRef } from 'react'
import Monorise, { 
  useMutuals,
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
  
  // Get channel data via HTTP
  const { entity: channel } = Monorise.useEntity('channel', channelId)
  
  // List messages in this channel via HTTP (initial load)
  const { mutuals, isLoading, isFirstFetched } = useMutuals('channel', 'message', channelId)
  
  // Subscribe to ALL message changes in this channel via WebSocket
  // This receives real-time updates when any message is created/updated/deleted
  useMutualSocket('channel', channelId, 'message')

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mutuals])

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
        <span className="channel-description">{channel?.data.description}</span>
      </div>
      
      <div className="messages">
        {isLoading && !isFirstFetched && (
          <div className="loading-messages">Loading messages...</div>
        )}
        
        {mutuals?.length === 0 && isFirstFetched && (
          <div className="no-messages">
            No messages yet. Start the conversation!
          </div>
        )}
        
        {mutuals?.map((mutual: any) => {
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
