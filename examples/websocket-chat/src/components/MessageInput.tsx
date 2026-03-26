import { useState, useCallback } from 'react'
import Monorise, { 
  useCreateEntitySocket,
  useCreateMutualSocket
} from '@monorise/react'
import { DEMO_USERS } from '../lib/monorise'

interface MessageInputProps {
  channelId: string
  currentUserId: string
}

export function MessageInput({ channelId, currentUserId }: MessageInputProps) {
  const [message, setMessage] = useState('')
  
  const currentUser = DEMO_USERS.find(u => u.userId === currentUserId)
  
  // Create message with optimistic updates
  const { 
    mutate: createMessage, 
    isPending, 
    isOptimistic 
  } = useCreateEntitySocket('message')
  
  // Create mutual relationship (message -> channel)
  const {
    mutate: createMutual,
  } = useCreateMutualSocket()

  const handleSend = useCallback(() => {
    if (!message.trim() || !currentUser) return

    const messageData = {
      content: message.trim(),
      channelId,
      authorId: currentUserId,
      authorName: currentUser.name,
    }

    // Create the message entity
    createMessage(messageData)
    
    // Note: In a real implementation, we'd need to:
    // 1. Get the created message ID back
    // 2. Create the mutual relationship between channel and message
    // For this demo, the broadcast handler will handle message delivery

    setMessage('')
  }, [message, channelId, currentUserId, currentUser, createMessage])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="message-input">
      <div className="input-container">
        <input
          type="text"
          placeholder={`Message as ${currentUser?.name}...`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isPending}
        />
        <button 
          onClick={handleSend} 
          disabled={!message.trim() || isPending}
          className="send-btn"
        >
          {isOptimistic ? '...' : '➤'}
        </button>
      </div>
    </div>
  )
}
