import type { CreatedEntity, Entity } from '@monorise/base';
import { useCallback, useEffect, useRef, useState } from 'react';
import { produce } from 'immer';
import type { MonoriseStore } from '../store/monorise.store';
import type {
  ConnectionState,
  ServerMessage,
  WebSocketManager,
} from '../websocket';

export interface UseEntitySocketReturn<T extends Entity> {
  entities: CreatedEntity<T>[];
  isLoading: boolean;
  isFetchingMore: boolean;
  isSubscribed: boolean;
  error: Error | null;
  isRefreshing: boolean;
  fetchMore: () => Promise<void>;
  hasMore: boolean;
}

export interface UseMutualSocketReturn<T extends Entity> {
  mutuals: unknown[];
  isLoading: boolean;
  isFetchingMore: boolean;
  isSubscribed: boolean;
  error: Error | null;
  isRefreshing: boolean;
  fetchMore: () => Promise<void>;
  hasMore: boolean;
}

export interface UseEntityFeedOptions {
  entityType: Entity;
  entityId: string;
  ticketEndpoint?: string;
}

export interface UseEntityFeedReturn {
  isConnected: boolean;
  error: { code: string; message: string } | null;
}

let globalWsManager: WebSocketManager | null = null;
let wsEndpoint: string | undefined;

export const initializeWebSocketManager = (
  WebSocketManagerClass: typeof WebSocketManager,
  endpoint: string,
  token?: string,
) => {
  if (globalWsManager) return globalWsManager;

  wsEndpoint = endpoint;
  globalWsManager = new WebSocketManagerClass(endpoint, token || '');
  globalWsManager.connect();

  return globalWsManager;
};

export const getWebSocketManager = () => globalWsManager;

export const initWebSocketActions = (
  monoriseStore: MonoriseStore,
  httpActions?: {
    listEntities: <T extends Entity>(
      entityType: T,
      params?: { limit?: number; lastKey?: string },
    ) => Promise<{ data: CreatedEntity<T>[]; lastKey?: string }>;
    listEntitiesByEntity: <B extends Entity, T extends Entity>(
      byEntityType: B,
      byEntityId: string,
      entityType: T,
      params?: { limit?: number; lastKey?: string },
    ) => Promise<{ entities: unknown[]; lastKey?: string }>;
  },
) => {
  const useEntitySocket = <T extends Entity>(
    entityType: T,
    opts: { limit?: number; skipInitialFetch?: boolean } = {},
  ): UseEntitySocketReturn<T> => {
    const { limit = 20, skipInitialFetch = false } = opts;
    const [isLoading, setIsLoading] = useState(!skipInitialFetch);
    const [isFetchingMore, setIsFetchingMore] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isSubscribed, setIsSubscribed] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [hasMore, setHasMore] = useState(true);
    const lastKeyRef = useRef<string | undefined>(undefined);
    const isFirstFetchRef = useRef(true);

    const entities = monoriseStore((state) => {
      const entityState = state.entity[entityType];
      return Array.from(entityState?.dataMap?.values() || []);
    });

    const fetchData = async (type: 'initial' | 'more' | 'refresh') => {
      if (type === 'more') {
        setIsFetchingMore(true);
      } else if (type === 'refresh') {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const fetchLastKey = type === 'refresh' ? undefined : lastKeyRef.current;
        const result = await httpActions!.listEntities(entityType, {
          limit,
          lastKey: fetchLastKey,
        });

        monoriseStore.setState(
          produce((state) => {
            if (type === 'refresh') {
              state.entity[entityType as unknown as string].dataMap.clear();
            }
            for (const entity of result.data) {
              state.entity[entityType as unknown as string].dataMap.set(entity.entityId, entity);
            }
            state.entity[entityType as unknown as string].isFirstFetched = true;
            state.entity[entityType as unknown as string].lastKey = result.lastKey;
          }),
        );

        lastKeyRef.current = result.lastKey;
        setHasMore(!!result.lastKey);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch'));
      } finally {
        setIsLoading(false);
        setIsFetchingMore(false);
        setIsRefreshing(false);
      }
    };

    useEffect(() => {
      if (skipInitialFetch) return;
      fetchData('initial');
    }, [entityType, limit, skipInitialFetch]);

    useEffect(() => {
      if (!globalWsManager) {
        setIsSubscribed(false);
        return;
      }

      const subKey = globalWsManager.subscribeEntityType(entityType as unknown as string);
      setIsSubscribed(true);

      let wasConnected = false;
      const unsubscribeState = globalWsManager.onStateChange((state) => {
        if (state === 'connected' && wasConnected === false && !isFirstFetchRef.current) {
          fetchData('refresh');
        }
        wasConnected = state === 'connected';
        isFirstFetchRef.current = false;
      });

      const unsubscribeMessage = globalWsManager.onMessage(
        (msg: ServerMessage) => {
          if (
            msg.type === 'entity.created' ||
            msg.type === 'entity.updated' ||
            msg.type === 'entity.deleted'
          ) {
            const payload = msg.payload as {
              entityType: string;
              entityId: string;
              data?: CreatedEntity<T>;
            };

            if (payload.entityType !== (entityType as unknown as string)) return;

            if (msg.type === 'entity.created' || msg.type === 'entity.updated') {
              if (payload.data) {
                monoriseStore.setState(
                  produce((state) => {
                    const key = entityType as unknown as string;
                    if (!state.entity[key]) {
                      state.entity[key] = { dataMap: new Map(), isFirstFetched: false, lastKey: undefined };
                    }
                    state.entity[key].dataMap.set(
                      payload.entityId,
                      payload.data!,
                    );
                  }),
                );
              }
            } else if (msg.type === 'entity.deleted') {
              monoriseStore.setState(
                produce((state) => {
                  const key = entityType as unknown as string;
                  if (state.entity[key]?.dataMap) {
                    state.entity[key].dataMap.delete(payload.entityId);
                  }
                }),
              );
            }
          }
        },
      );

      return () => {
        globalWsManager?.unsubscribeEntityType(subKey);
        unsubscribeState();
        unsubscribeMessage();
        setIsSubscribed(false);
      };
    }, [entityType]);

    const fetchMore = async () => {
      if (!hasMore || isFetchingMore) return;
      await fetchData('more');
    };

    return {
      entities,
      isLoading,
      isFetchingMore,
      isSubscribed,
      error,
      isRefreshing,
      fetchMore,
      hasMore,
    };
  };

  const useMutualSocket = <B extends Entity, T extends Entity>(
    byEntityType: B,
    byEntityId: string | undefined,
    mutualEntityType: T,
    opts: { limit?: number; skipInitialFetch?: boolean } = {},
  ): UseMutualSocketReturn<T> => {
    const { limit = 20, skipInitialFetch = false } = opts;
    const [isLoading, setIsLoading] = useState(
      !skipInitialFetch && !!byEntityId,
    );
    const [isFetchingMore, setIsFetchingMore] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isSubscribed, setIsSubscribed] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [hasMore, setHasMore] = useState(true);
    const lastKeyRef = useRef<string | undefined>(undefined);
    const isFirstFetchRef = useRef(true);

    const mutualKey = byEntityId
      ? `${byEntityType}/${byEntityId}/${mutualEntityType}`
      : '';

    const mutuals = monoriseStore((state) => {
      return Array.from(state.mutual[mutualKey]?.dataMap?.values() || []);
    });

    const fetchData = async (type: 'initial' | 'more' | 'refresh') => {
      if (!byEntityId) return;

      if (type === 'more') {
        setIsFetchingMore(true);
      } else if (type === 'refresh') {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const fetchLastKey = type === 'refresh' ? undefined : lastKeyRef.current;
        const result = await httpActions!.listEntitiesByEntity(
          byEntityType,
          byEntityId,
          mutualEntityType,
          { limit, lastKey: fetchLastKey },
        );

        monoriseStore.setState(
          produce((state) => {
            if (!state.mutual[mutualKey]) {
              state.mutual[mutualKey] = {
                dataMap: new Map(),
                isFirstFetched: true,
                lastKey: undefined as unknown as string,
              };
            }
            if (type === 'refresh') {
              state.mutual[mutualKey].dataMap.clear();
            }
            for (const entity of result.entities) {
              const e = entity as any;
              state.mutual[mutualKey].dataMap.set(e.entityId, entity);
            }
            state.mutual[mutualKey].lastKey = result.lastKey;
          }),
        );

        lastKeyRef.current = result.lastKey;
        setHasMore(!!result.lastKey);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch'));
      } finally {
        setIsLoading(false);
        setIsFetchingMore(false);
        setIsRefreshing(false);
      }
    };

    useEffect(() => {
      if (skipInitialFetch || !byEntityId) {
        setIsLoading(false);
        return;
      }
      lastKeyRef.current = undefined;
      setHasMore(true);
      isFirstFetchRef.current = true;
      fetchData('initial');
    }, [byEntityType, byEntityId, mutualEntityType, limit, skipInitialFetch]);

    useEffect(() => {
      if (!globalWsManager || !byEntityId) {
        setIsSubscribed(false);
        return;
      }

      const subKey = globalWsManager.subscribeMutualType(
        byEntityType as unknown as string,
        byEntityId,
        mutualEntityType as unknown as string,
      );
      setIsSubscribed(true);

      let wasConnected = false;
      const unsubscribeState = globalWsManager.onStateChange((state) => {
        if (state === 'connected' && wasConnected === false && !isFirstFetchRef.current) {
          fetchData('refresh');
        }
        wasConnected = state === 'connected';
        isFirstFetchRef.current = false;
      });

      const unsubscribeMessage = globalWsManager.onMessage(
        (msg: ServerMessage) => {
          if (
            msg.type === 'mutual.created' ||
            msg.type === 'mutual.updated' ||
            msg.type === 'mutual.deleted'
          ) {
            const payload = msg.payload as {
              byEntityType: string;
              byEntityId: string;
              mutualEntityType: string;
              entityId: string;
              data?: unknown;
            };

            if (
              payload.byEntityType !== (byEntityType as unknown as string) ||
              payload.byEntityId !== byEntityId ||
              payload.mutualEntityType !== (mutualEntityType as unknown as string)
            ) {
              return;
            }

            if (
              msg.type === 'mutual.created' ||
              msg.type === 'mutual.updated'
            ) {
              if (payload.data) {
                monoriseStore.setState(
                  produce((state) => {
                    if (!state.mutual[mutualKey]) {
                      state.mutual[mutualKey] = {
                        dataMap: new Map(),
                        isFirstFetched: true,
                        lastKey: undefined as unknown as string,
                      };
                    }
                    state.mutual[mutualKey].dataMap.set(
                      payload.entityId,
                      payload.data!,
                    );
                  }),
                );
              }
            } else if (msg.type === 'mutual.deleted') {
              monoriseStore.setState(
                produce((state) => {
                  state.mutual[mutualKey]?.dataMap.delete(payload.entityId);
                }),
              );
            }
          }
        },
      );

      return () => {
        globalWsManager?.unsubscribeMutualType(subKey);
        unsubscribeState();
        unsubscribeMessage();
        setIsSubscribed(false);
      };
    }, [byEntityType, byEntityId, mutualEntityType, mutualKey]);

    const fetchMore = async () => {
      if (!hasMore || isFetchingMore) return;
      await fetchData('more');
    };

    return {
      mutuals,
      isLoading,
      isFetchingMore,
      isSubscribed,
      error,
      isRefreshing,
      fetchMore,
      hasMore,
    };
  };

  const useEphemeralSocket = <T = unknown>(
    channel: string | undefined,
    opts?: {
      onMessage?: (data: T, senderId?: string) => void;
    },
  ): {
    isSubscribed: boolean;
    send: (data: T) => void;
  } => {
    const [isSubscribed, setIsSubscribed] = useState(false);

    useEffect(() => {
      if (!globalWsManager || !channel) {
        setIsSubscribed(false);
        return;
      }

      const subKey = globalWsManager.subscribeEphemeral(channel);
      setIsSubscribed(true);

      const unsubscribeMessage = globalWsManager.onMessage(
        (msg: ServerMessage) => {
          if (msg.type === 'ephemeral') {
            const payload = msg.payload as {
              channel: string;
              data: T;
              senderId?: string;
            };
            if (payload.channel !== channel) return;
            opts?.onMessage?.(payload.data, payload.senderId);
          }
        },
      );

      return () => {
        globalWsManager?.unsubscribeEphemeral(subKey);
        unsubscribeMessage();
        setIsSubscribed(false);
      };
    }, [channel]);

    const send = useCallback(
      (data: T) => {
        if (!globalWsManager || !channel) return;
        globalWsManager.sendEphemeral(channel, data);
      },
      [channel],
    );

    return { isSubscribed, send };
  };

  /**
   * Subscribe to an entity's real-time feed.
   *
   * Fetches a ticket (via ticketEndpoint or default monorise route through catch-all proxy),
   * establishes a WebSocket connection, and auto-updates entity/mutual stores.
   * Handles ticket refresh and auto-resync on reconnect.
   *
   * @example
   * ```tsx
   * // Internal app (uses catch-all proxy)
   * useEntityFeed({ entityType: Entity.USER, entityId: userId });
   *
   * // Client-facing app (custom auth endpoint)
   * useEntityFeed({ entityType: Entity.USER, entityId: userId, ticketEndpoint: '/api/ws/ticket' });
   * ```
   */
  const useEntityFeed = (opts: UseEntityFeedOptions): UseEntityFeedReturn => {
    const { entityType, entityId, ticketEndpoint } = opts;
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<{ code: string; message: string } | null>(null);
    const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);
    const wsManagerRef = useRef<WebSocketManager | null>(null);
    const isMountedRef = useRef(true);

    const fetchTicket = useCallback(async () => {
      try {
        const url = ticketEndpoint
          || `/api/core/ws/ticket/${entityType}/${entityId}`;

        const fetchOpts: RequestInit = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        };

        // Only send body for custom endpoints (default route gets params from URL)
        if (ticketEndpoint) {
          fetchOpts.body = JSON.stringify({ entityType, entityId });
        }

        const response = await fetch(url, fetchOpts);

        if (response.status === 401 || response.status === 403) {
          return { error: { code: 'TICKET_UNAUTHORIZED', message: 'Unauthorized' } };
        }

        if (!response.ok) {
          return { error: { code: 'TICKET_FAILED', message: `HTTP ${response.status}` } };
        }

        const data = await response.json();
        return { data: data as { ticket: string; wsUrl: string; expiresIn: number } };
      } catch (err) {
        return { error: { code: 'TICKET_FAILED', message: (err as Error).message } };
      }
    }, [entityType, entityId, ticketEndpoint]);

    const connectWithTicket = useCallback(async () => {
      const result = await fetchTicket();

      if (!isMountedRef.current) return;

      if (result.error) {
        setError(result.error);
        setIsConnected(false);
        return;
      }

      setError(null);
      const { ticket, wsUrl, expiresIn } = result.data!;

      // Disconnect existing connection if any
      if (wsManagerRef.current) {
        wsManagerRef.current.disconnect();
      }

      // Use the WebSocketManager class from the module scope
      // Import dynamically to avoid circular deps
      const { WebSocketManager: WsManagerClass } = await import('../websocket');

      const manager = new WsManagerClass(wsUrl, ticket);
      wsManagerRef.current = manager;

      // Also set as global so other hooks (useMutualSocket etc.) can use it
      globalWsManager = manager;

      manager.onStateChange((state: ConnectionState) => {
        if (!isMountedRef.current) return;

        if (state === 'connected') {
          setIsConnected(true);
          setError(null);
        } else if (state === 'disconnected') {
          setIsConnected(false);
        }
      });

      // Route feed messages into stores
      manager.onMessage((msg: ServerMessage) => {
        if (!isMountedRef.current) return;

        if (msg.type === 'entity.created' || msg.type === 'entity.updated') {
          const payload = msg.payload as {
            entityType: string;
            entityId: string;
            data?: any;
          };
          if (payload.data) {
            monoriseStore.setState(
              produce((state) => {
                const key = payload.entityType;
                if (!state.entity[key]) {
                  state.entity[key] = { dataMap: new Map(), isFirstFetched: false, lastKey: undefined };
                }
                state.entity[key].dataMap.set(payload.entityId, payload.data);
              }),
            );
          }
        } else if (msg.type === 'entity.deleted') {
          const payload = msg.payload as { entityType: string; entityId: string };
          monoriseStore.setState(
            produce((state) => {
              state.entity[payload.entityType]?.dataMap?.delete(payload.entityId);
            }),
          );
        } else if (msg.type === 'mutual.created' || msg.type === 'mutual.updated') {
          const payload = msg.payload as {
            byEntityType: string;
            byEntityId: string;
            mutualEntityType: string;
            entityId: string;
            data?: any;
          };
          if (payload.data) {
            const mutualKey = `${payload.byEntityType}/${payload.byEntityId}/${payload.mutualEntityType}`;
            monoriseStore.setState(
              produce((state) => {
                if (!state.mutual[mutualKey]) {
                  state.mutual[mutualKey] = { dataMap: new Map(), isFirstFetched: false, lastKey: undefined };
                }
                state.mutual[mutualKey].dataMap.set(payload.entityId, payload.data);
              }),
            );
          }
        } else if (msg.type === 'mutual.deleted') {
          const payload = msg.payload as {
            byEntityType: string;
            byEntityId: string;
            mutualEntityType: string;
            entityId: string;
          };
          const mutualKey = `${payload.byEntityType}/${payload.byEntityId}/${payload.mutualEntityType}`;
          monoriseStore.setState(
            produce((state) => {
              state.mutual[mutualKey]?.dataMap?.delete(payload.entityId);
            }),
          );
        }
      });

      manager.connect();

      // Schedule proactive ticket refresh
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      const refreshMs = Math.max((expiresIn - 120) * 1000, 60000); // refresh 2 min before expiry, minimum 1 min
      refreshTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          connectWithTicket();
        }
      }, refreshMs);
    }, [fetchTicket]);

    useEffect(() => {
      isMountedRef.current = true;

      if (entityId) {
        connectWithTicket();
      }

      return () => {
        isMountedRef.current = false;
        if (refreshTimerRef.current) {
          clearTimeout(refreshTimerRef.current);
        }
        if (wsManagerRef.current) {
          wsManagerRef.current.disconnect();
          wsManagerRef.current = null;
        }
      };
    }, [entityType, entityId, connectWithTicket]);

    return { isConnected, error };
  };

  return {
    useEntitySocket,
    useMutualSocket,
    useEphemeralSocket,
    useEntityFeed,
  };
};

export type WebSocketActions = ReturnType<typeof initWebSocketActions>;
