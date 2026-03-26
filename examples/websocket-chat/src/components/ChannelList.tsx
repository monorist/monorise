import { useState, useCallback } from 'react'
import Monorise, { 
  useEntitySocket,
  useWebSocketConnection 
} from '@monorise/react'
import { DEMO_USERS } from '../lib/monorise'

interface ChannelListProps {
  currentUserId: string
  selectedChannelId: string | null
  onSelectChannel: (channelId: string) => void
}

export function ChannelList({ 
  currentUserId, 
  selectedChannelId, 
  onSelectChannel 
}: ChannelListProps) {
  const [newChannelName, setNewChannelName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  
  const { state: wsState } = useWebSocketConnection()
  
  // Hook handles initial fetch + WebSocket subscription
  const { 
    entities: channels, 
    isLoading,
    isSubscribed,
    fetchMore 
  } = useEntitySocket('channel', { limit: 20 })
  
  const { createEntity } = Monorise

  const handleCreateChannel = useCallback(async () => {
    if (!newChannelName.trim()) return
    
    const currentUser = DEMO_USERS.find(u => u.userId === currentUserId)
    
    await createEntity('channel', {
      name: newChannelName.trim(),
      description: `Created by ${currentUser?.name}`,
      createdBy: currentUserId,
    })
    
    setNewChannelName('')
    setIsCreating(false)
  }, [newChannelName, currentUserId, createEntity])

  const getConnectionStatus = () => {
    switch (wsState) {
      case 'connected': return '🟢 Connected'
      case 'connecting': return '🟡 Connecting...'
      case 'reconnecting': return '🟠 Reconnecting...'
      case 'disconnected': return '🔴 Disconnected'
      default: return '⚪ Unknown'
    }
  }

  return (
    <div className="channel-list">
      <div className="channel-header">
        <h3>Channels</h3>
        <span className="connection-status">
          {getConnectionStatus()}
          {isSubscribed && ' (live)'}
        </span>
      </div>
      
      {isLoading && <div className="loading">Loading channels...</div>}
      
      <div className="channels">
        {Array.from(channels?.values() || []).map(channel => (
          <button
            key={channel.entityId}
            className={`channel-item ${selectedChannelId === channel.entityId ? 'active' : ''}`}
            onClick={() => onSelectChannel(channel.entityId)}
          >
            <span className="channel-icon">#</span>
            <span className="channel-name">{channel.data.name}</span>
          </button>
        ))}
      </div>

      <button className="load-more-btn" onClick={fetchMore}>
        Load More
      </button>
      
      {isCreating ? (
        <div className="create-channel-form">
          <input
            type="text"
            placeholder="Channel name"
            value={newChannelName}
            onChange={(e) => setNewChannelName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateChannel()}
            autoFocus
          />
          <div className="form-buttons">
            <button onClick={handleCreateChannel}>Create</button>
            <button onClick={() => setIsCreating(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="add-channel-btn" onClick={() => setIsCreating(true)}>
          + Add Channel
        </button>
      )}
    </div>
  )
}
