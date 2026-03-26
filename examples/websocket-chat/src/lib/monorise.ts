import Monorise, { initWebSocket } from '@monorise/react'
import { WebSocketManager } from '@monorise/core'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3002'

// Demo users for testing
export const DEMO_USERS = [
  { userId: 'user-1', name: 'Alice Johnson', email: 'alice@example.com' },
  { userId: 'user-2', name: 'Bob Smith', email: 'bob@example.com' },
  { userId: 'user-3', name: 'Charlie Brown', email: 'charlie@example.com' },
  { userId: 'user-4', name: 'Diana Prince', email: 'diana@example.com' },
]

export const initMonorise = () => {
  Monorise.config({
    entityBaseUrl: `${API_URL}/core`,
    mutualBaseUrl: `${API_URL}/core`,
    authBaseUrl: API_URL,
    entityConfig: {
      user: {
        schema: {
          name: { type: 'string', required: true },
          email: { type: 'string', required: true },
          avatar: { type: 'string' },
        },
        uniqueFields: ['email'],
      },
      channel: {
        schema: {
          name: { type: 'string', required: true },
          description: { type: 'string' },
          createdBy: { type: 'string', required: true },
        },
      },
      message: {
        schema: {
          content: { type: 'string', required: true },
          channelId: { type: 'string', required: true },
          authorId: { type: 'string', required: true },
          authorName: { type: 'string', required: true },
        },
      },
    },
  })
}

export const initChatWebSocket = (userId: string) => {
  // Use userId as a simple token for demo
  const wsManager = new WebSocketManager(WS_URL, userId)
  initWebSocket(wsManager, WS_URL)
  wsManager.connect()
  return wsManager
}

export { Monorise }
