import { useState, useCallback } from 'react'
import Monorise, { 
  useEntities, 
  useCreateEntitySocket,
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
  
  // Use WebSocket connection hook
  const { state: wsState } = useWebSocketConnection()
  
  // List all channels
  const { entities: channels, isLoading } = useEntities('channel', { all: true })
  
  // Subscribe to channel updates via WebSocket
  channels?.forEach(channel => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEntitySocket('channel', channel.entityId)
  })
  
  // Create channel with optimistic updates
  const { mutate: createChannel, isPending, isOptimistic } = useCreateEntitySocket('channel')

  const handleCreateChannel = useCallback(() => {
    if (!newChannelName.trim()) return
    
    const currentUser = DEMO_USERS.find(u => u.userId === currentUserId)
    
    createChannel({
      name: newChannelName.trim(),
      description: `Created by ${currentUser?.name}`,
      createdBy: currentUserId,
    })
    
    setNewChannelName('')
    setIsCreating(false)
  }, [newChannelName, currentUserId, createChannel])

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
        <span className="connection-status">{getConnectionStatus()}</span>
      </div>
      
      {isLoading && <div className="loading">Loading channels...</div>}
      
      <div className="channels">
        {channels?.map(channel => (
          <button
            key={channel.entityId}
            className={`channel-item ${selectedChannelId === channel.entityId ? 'active' : ''}`}
            onClick={() => onSelectChannel(channel.entityId)}
          >
            <span className="channel-icon">#</span>
            <span className="channel-name">{channel.data.name}</span>
            {channel.isOptimistic && <span className="optimistic-badge">syncing...</span>}
          </button>
        ))}
      </div>
      
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
            <button onClick={handleCreateChannel} disabled={isPending}>
              {isOptimistic ? 'Creating...' : 'Create'}
            </button>
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
