import { useState, useCallback } from 'react'
import './App.css'
import { UserSelector } from './components/UserSelector'
import { ChannelList } from './components/ChannelList'
import { ChatWindow } from './components/ChatWindow'
import { MessageInput } from './components/MessageInput'
import { initChatWebSocket } from './lib/monorise'

function App() {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)

  const handleUserSelect = useCallback((userId: string) => {
    setCurrentUserId(userId)
    // Initialize WebSocket connection for this user
    initChatWebSocket(userId)
  }, [])

  const handleChannelSelect = useCallback((channelId: string) => {
    setSelectedChannelId(channelId)
  }, [])

  if (!currentUserId) {
    return (
      <div className="login-screen">
        <div className="login-box">
          <h1>WebSocket Chat Demo</h1>
          <p>Select a user to start chatting</p>
          <UserSelector onSelect={handleUserSelect} />
        </div>
      </div>
    )
  }

  return (
    <div className="chat-app">
      <div className="sidebar">
        <div className="user-info">
          <span className="user-label">Logged in as:</span>
          <UserSelector onSelect={handleUserSelect} currentUserId={currentUserId} />
        </div>
        <ChannelList 
          currentUserId={currentUserId}
          selectedChannelId={selectedChannelId}
          onSelectChannel={handleChannelSelect}
        />
      </div>
      <div className="main-panel">
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
          <div className="empty-state">
            <p>Select a channel to start chatting</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
