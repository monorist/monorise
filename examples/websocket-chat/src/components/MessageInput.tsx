import { useState, useCallback } from 'react'
import Monorise from '@monorise/react'
import { DEMO_USERS } from '../lib/monorise'

interface MessageInputProps {
  channelId: string
  currentUserId: string
}

export function MessageInput({ channelId, currentUserId }: MessageInputProps) {
  const [message, setMessage] = useState('')
  
  const currentUser = DEMO_USERS.find(u => u.userId === currentUserId)
  
  // Create message via HTTP (with existing optimistic update)
  const { createEntity } = Monorise
  // Create mutual relationship (message -> channel)
  const { createMutual } = Monorise

  const handleSend = useCallback(async () => {
    if (!message.trim() || !currentUser) return

    // Create the message entity via HTTP
    const { data: newMessage } = await createEntity('message', {
      content: message.trim(),
      channelId,
      authorId: currentUserId,
      authorName: currentUser.name,
    })

    // Create mutual relationship between channel and message
    if (newMessage) {
      await createMutual('channel', 'message', channelId, newMessage.entityId)
    }

    setMessage('')
  }, [message, channelId, currentUserId, currentUser, createEntity, createMutual])

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
        />
        <button 
          onClick={handleSend} 
          disabled={!message.trim()}
          className="send-btn"
        >
          ➤
        </button>
      </div>
    </div>
  )
}
