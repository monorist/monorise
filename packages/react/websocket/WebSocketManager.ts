import { nanoid } from 'nanoid';

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

export interface ClientMessage {
  action: 'subscribe' | 'unsubscribe' | 'mutate' | 'ping';
  id: string;
  payload: {
    entityType?: string;
    entityId?: string;
    byEntityType?: string;
    byEntityId?: string;
    data?: unknown;
  };
}

export interface ServerMessage {
  type:
    | 'entity.created'
    | 'entity.updated'
    | 'entity.deleted'
    | 'mutual.created'
    | 'mutual.updated'
    | 'mutual.deleted'
    | 'ack'
    | 'error'
    | 'pong';
  id: string;
  payload: unknown;
}

type MessageHandler = (message: ServerMessage) => void;
type ConnectionStateHandler = (state: ConnectionState) => void;

interface Subscription {
  entityType: string;
  entityId: string;
  byEntityType?: string;
  byEntityId?: string;
}

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // Start with 1s
  private maxReconnectDelay = 30000; // Max 30s
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatTimeout: NodeJS.Timeout | null = null;
  private readonly heartbeatIntervalMs = 30000; // 30s
  private readonly heartbeatTimeoutMs = 10000; // 10s

  private messageHandlers: Set<MessageHandler> = new Set();
  private stateHandlers: Set<ConnectionStateHandler> = new Set();
  private subscriptions: Map<string, Subscription> = new Map();
  private pendingMessages: ClientMessage[] = [];

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  // Public API
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.setState('connecting');

    try {
      // Append token as query param
      const urlWithToken = `${this.url}?token=${encodeURIComponent(this.token)}`;
      this.ws = new WebSocket(urlWithToken);

      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
      this.ws.onerror = this.handleError.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
    } catch (error) {
      console.error('WebSocket connection error:', error);
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.reconnectAttempts = 0; // Prevent auto-reconnect on manual disconnect

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setState('disconnected');
  }

  subscribe(subscription: Subscription): string {
    const subKey = this.getSubscriptionKey(subscription);

    // Store subscription locally
    if (!this.subscriptions.has(subKey)) {
      this.subscriptions.set(subKey, subscription);
    }

    // Send subscribe message if connected
    if (this.state === 'connected') {
      const message: ClientMessage = {
        action: 'subscribe',
        id: nanoid(),
        payload: {
          entityType: subscription.entityType,
          entityId: subscription.entityId,
          byEntityType: subscription.byEntityType,
          byEntityId: subscription.byEntityId,
        },
      };
      this.send(message);
    }

    return subKey;
  }

  unsubscribe(subKey: string): void {
    const subscription = this.subscriptions.get(subKey);
    if (!subscription) return;

    this.subscriptions.delete(subKey);

    // Send unsubscribe message if connected
    if (this.state === 'connected') {
      const message: ClientMessage = {
        action: 'unsubscribe',
        id: nanoid(),
        payload: {
          entityType: subscription.entityType,
          entityId: subscription.entityId,
          byEntityType: subscription.byEntityType,
          byEntityId: subscription.byEntityId,
        },
      };
      this.send(message);
    }
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      // Queue message for when connection is ready
      this.pendingMessages.push(message);
    }
  }

  // Event handlers
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStateChange(handler: ConnectionStateHandler): () => void {
    this.stateHandlers.add(handler);
    // Immediately call with current state
    handler(this.state);
    return () => this.stateHandlers.delete(handler);
  }

  getState(): ConnectionState {
    return this.state;
  }

  // Convenience methods for entity type subscriptions
  subscribeEntityType(entityType: string): string {
    return this.subscribe({
      entityType,
      entityId: '*',
    });
  }

  unsubscribeEntityType(subKey: string): void {
    this.unsubscribe(subKey);
  }

  // Convenience methods for mutual subscriptions
  subscribeMutualType(
    byEntityType: string,
    byEntityId: string,
    entityType: string,
  ): string {
    return this.subscribe({
      entityType,
      entityId: '*',
      byEntityType,
      byEntityId,
    });
  }

  unsubscribeMutualType(subKey: string): void {
    this.unsubscribe(subKey);
  }

  // Private methods
  private setState(newState: ConnectionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.stateHandlers.forEach((handler) => handler(newState));
    }
  }

  private handleOpen(): void {
    this.setState('connected');
    this.reconnectAttempts = 0;
    this.reconnectDelay = 1000;

    // Start heartbeat
    this.startHeartbeat();

    // Re-subscribe to all active subscriptions
    this.resubscribeAll();

    // Send any pending messages
    this.flushPendingMessages();
  }

  private handleClose(event: CloseEvent): void {
    this.stopHeartbeat();
    this.ws = null;

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.setState('reconnecting');
      this.scheduleReconnect();
    } else {
      this.setState('disconnected');
    }
  }

  private handleError(error: Event): void {
    console.error('WebSocket error:', error);
    // Error handling is done in handleClose
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data) as ServerMessage;

      // Handle pong
      if (message.type === 'pong') {
        this.handlePong();
        return;
      }

      // Notify all message handlers
      this.messageHandlers.forEach((handler) => handler(message));
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  private scheduleReconnect(): void {
    setTimeout(() => {
      this.reconnectAttempts++;
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        this.maxReconnectDelay,
      );
      this.connect();
    }, this.reconnectDelay);
  }

  private resubscribeAll(): void {
    for (const subscription of this.subscriptions.values()) {
      const message: ClientMessage = {
        action: 'subscribe',
        id: nanoid(),
        payload: {
          entityType: subscription.entityType,
          entityId: subscription.entityId,
          byEntityType: subscription.byEntityType,
          byEntityId: subscription.byEntityId,
        },
      };
      this.send(message);
    }
  }

  private flushPendingMessages(): void {
    while (this.pendingMessages.length > 0) {
      const message = this.pendingMessages.shift();
      if (message) {
        this.send(message);
      }
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      // Send ping
      const pingMessage: ClientMessage = {
        action: 'ping',
        id: nanoid(),
        payload: {},
      };
      this.send(pingMessage);

      // Set timeout for pong response
      this.heartbeatTimeout = setTimeout(() => {
        console.warn('WebSocket heartbeat timeout - reconnecting');
        this.ws?.close();
      }, this.heartbeatTimeoutMs);
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  private handlePong(): void {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  private getSubscriptionKey(subscription: Subscription): string {
    if (subscription.byEntityType && subscription.byEntityId) {
      return `${subscription.byEntityType}:${subscription.byEntityId}:${subscription.entityType}:${subscription.entityId}`;
    }
    return `${subscription.entityType}:${subscription.entityId}`;
  }
}
