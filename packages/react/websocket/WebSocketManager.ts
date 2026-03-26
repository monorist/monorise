import { nanoid } from 'nanoid';

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

export interface ClientMessage {
  action: 'subscribe' | 'unsubscribe' | 'ephemeral' | 'ping';
  id: string;
  payload: {
    // Entity subscription: subscribe to all changes of this entity type
    entityType?: string;
    // Mutual subscription: subscribe to all mutuals of this type for a byEntity
    byEntityType?: string;
    byEntityId?: string;
    mutualEntityType?: string;
    // Ephemeral channel
    channel?: string;
    // Ephemeral message data
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
    | 'ephemeral'
    | 'ack'
    | 'error'
    | 'pong';
  id: string;
  payload: unknown;
}

type MessageHandler = (message: ServerMessage) => void;
type ConnectionStateHandler = (state: ConnectionState) => void;

// Entity type subscription: listen to ALL changes of this entity type
interface EntityTypeSubscription {
  entityType: string;
}

// Mutual type subscription: listen to ALL mutuals of this type for a byEntity
interface MutualTypeSubscription {
  byEntityType: string;
  byEntityId: string;
  mutualEntityType: string;
}

// Ephemeral channel subscription: listen to ephemeral messages on this channel
interface EphemeralSubscription {
  channel: string;
}

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatTimeout: NodeJS.Timeout | null = null;
  private readonly heartbeatIntervalMs = 30000;
  private readonly heartbeatTimeoutMs = 10000;

  private messageHandlers: Set<MessageHandler> = new Set();
  private stateHandlers: Set<ConnectionStateHandler> = new Set();
  private entitySubscriptions: Map<string, EntityTypeSubscription> = new Map();
  private mutualSubscriptions: Map<string, MutualTypeSubscription> = new Map();
  private ephemeralSubscriptions: Map<string, EphemeralSubscription> = new Map();
  private pendingMessages: ClientMessage[] = [];

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.setState('connecting');

    try {
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
    this.reconnectAttempts = 0;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setState('disconnected');
  }

  // Subscribe to ALL changes of an entity type
  subscribeEntityType(entityType: string): string {
    const subKey = `entity:${entityType}`;

    if (!this.entitySubscriptions.has(subKey)) {
      this.entitySubscriptions.set(subKey, { entityType });
    }

    if (this.state === 'connected') {
      const message: ClientMessage = {
        action: 'subscribe',
        id: nanoid(),
        payload: { entityType },
      };
      this.send(message);
    }

    return subKey;
  }

  unsubscribeEntityType(subKey: string): void {
    const subscription = this.entitySubscriptions.get(subKey);
    if (!subscription) return;

    this.entitySubscriptions.delete(subKey);

    if (this.state === 'connected') {
      const message: ClientMessage = {
        action: 'unsubscribe',
        id: nanoid(),
        payload: { entityType: subscription.entityType },
      };
      this.send(message);
    }
  }

  // Subscribe to ALL mutuals of a type for a specific byEntity
  subscribeMutualType(
    byEntityType: string,
    byEntityId: string,
    mutualEntityType: string,
  ): string {
    const subKey = `mutual:${byEntityType}:${byEntityId}:${mutualEntityType}`;

    if (!this.mutualSubscriptions.has(subKey)) {
      this.mutualSubscriptions.set(subKey, {
        byEntityType,
        byEntityId,
        mutualEntityType,
      });
    }

    if (this.state === 'connected') {
      const message: ClientMessage = {
        action: 'subscribe',
        id: nanoid(),
        payload: { byEntityType, byEntityId, mutualEntityType },
      };
      this.send(message);
    }

    return subKey;
  }

  unsubscribeMutualType(subKey: string): void {
    const subscription = this.mutualSubscriptions.get(subKey);
    if (!subscription) return;

    this.mutualSubscriptions.delete(subKey);

    if (this.state === 'connected') {
      const message: ClientMessage = {
        action: 'unsubscribe',
        id: nanoid(),
        payload: {
          byEntityType: subscription.byEntityType,
          byEntityId: subscription.byEntityId,
          mutualEntityType: subscription.mutualEntityType,
        },
      };
      this.send(message);
    }
  }

  // Subscribe to ephemeral messages on a channel
  subscribeEphemeral(channel: string): string {
    const subKey = `ephemeral:${channel}`;

    if (!this.ephemeralSubscriptions.has(subKey)) {
      this.ephemeralSubscriptions.set(subKey, { channel });
    }

    if (this.state === 'connected') {
      const message: ClientMessage = {
        action: 'subscribe',
        id: nanoid(),
        payload: { channel },
      };
      this.send(message);
    }

    return subKey;
  }

  unsubscribeEphemeral(subKey: string): void {
    const subscription = this.ephemeralSubscriptions.get(subKey);
    if (!subscription) return;

    this.ephemeralSubscriptions.delete(subKey);

    if (this.state === 'connected') {
      const message: ClientMessage = {
        action: 'unsubscribe',
        id: nanoid(),
        payload: { channel: subscription.channel },
      };
      this.send(message);
    }
  }

  // Send an ephemeral message to a channel
  sendEphemeral(channel: string, data: unknown): void {
    const message: ClientMessage = {
      action: 'ephemeral',
      id: nanoid(),
      payload: { channel, data },
    };
    this.send(message);
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.pendingMessages.push(message);
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStateChange(handler: ConnectionStateHandler): () => void {
    this.stateHandlers.add(handler);
    handler(this.state);
    return () => this.stateHandlers.delete(handler);
  }

  getState(): ConnectionState {
    return this.state;
  }

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

    this.startHeartbeat();
    this.resubscribeAll();
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
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data) as ServerMessage;

      if (message.type === 'pong') {
        this.handlePong();
        return;
      }

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
    // Re-subscribe entity types
    for (const { entityType } of this.entitySubscriptions.values()) {
      const message: ClientMessage = {
        action: 'subscribe',
        id: nanoid(),
        payload: { entityType },
      };
      this.send(message);
    }

    // Re-subscribe mutual types
    for (const {
      byEntityType,
      byEntityId,
      mutualEntityType,
    } of this.mutualSubscriptions.values()) {
      const message: ClientMessage = {
        action: 'subscribe',
        id: nanoid(),
        payload: { byEntityType, byEntityId, mutualEntityType },
      };
      this.send(message);
    }

    // Re-subscribe ephemeral channels
    for (const { channel } of this.ephemeralSubscriptions.values()) {
      const message: ClientMessage = {
        action: 'subscribe',
        id: nanoid(),
        payload: { channel },
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
      const pingMessage: ClientMessage = {
        action: 'ping',
        id: nanoid(),
        payload: {},
      };
      this.send(pingMessage);

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
}
