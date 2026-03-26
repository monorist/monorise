import { useState, useCallback, useRef, useEffect } from 'react'
import Monorise, { useEphemeralSocket } from '@monorise/react'
import { DEMO_USERS } from '../lib/monorise'

interface MessageInputProps {
  channelId: string
  currentUserId: string
}

interface TypingEvent {
  type: 'typing' | 'stopped'
  userId: string
  userName: string
  channelId: string
}

export function MessageInput({ channelId, currentUserId }: MessageInputProps) {
  const [message, setMessage] = useState('')
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isTypingRef = useRef(false)
  
  const currentUser = DEMO_USERS.find(u => u.userId === currentUserId)
  
  // Create message via HTTP (with existing optimistic update)
  const { createEntity } = Monorise
  // Create mutual relationship (message -> channel)
  const { createMutual } = Monorise

  // Send typing events
  const { send } = useEphemeralSocket<TypingEvent>(`channel:${channelId}:typing`)

  const sendTypingEvent = useCallback((type: 'typing' | 'stopped') => {
    if (!currentUser) return
    send({
      type,
      userId: currentUserId,
      userName: currentUser.name,
      channelId,
    })
  }, [send, currentUser, currentUserId, channelId])

  const handleTyping = useCallback((value: string) => {
    setMessage(value)

    // Send typing event
    if (!isTypingRef.current && value.trim()) {
      isTypingRef.current = true
      sendTypingEvent('typing')
    }

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

    // Set new timeout to send stopped event after 2 seconds of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      if (isTypingRef.current) {
        isTypingRef.current = false
        sendTypingEvent('stopped')
      }
    }, 2000)
  }, [sendTypingEvent])

  const handleSend = useCallback(async () => {
    if (!message.trim() || !currentUser) return

    // Send stopped typing event immediately
    if (isTypingRef.current) {
      isTypingRef.current = false
      sendTypingEvent('stopped')
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

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
  }, [message, channelId, currentUserId, currentUser, createEntity, createMutual, sendTypingEvent])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
      }
      // Send stopped event if still typing
      if (isTypingRef.current) {
        sendTypingEvent('stopped')
      }
    }
  }, [sendTypingEvent])

  return (
    <div className="message-input">
      <div className="input-container">
        <input
          type="text"
          placeholder={`Message as ${currentUser?.name}...`}
          value={message}
          onChange={(e) => handleTyping(e.target.value)}
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
