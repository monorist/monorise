import type {
  ConnectionState,
  CreatedEntity,
  Entity,
  ServerMessage,
  WebSocketManager,
} from '@monorise/core';
import { useEffect, useRef, useState } from 'react';
import type { MonoriseStore } from '../store/monorise.store';

interface UseWebSocketConnectionReturn {
  state: ConnectionState;
  connect: () => void;
  disconnect: () => void;
}

interface UseEntitySocketOptions {
  /** Number of records to fetch initially. Default: 20 */
  limit?: number;
  /** Skip initial HTTP fetch. Useful if you already have the data. Default: false */
  skipInitialFetch?: boolean;
}

interface UseEntitySocketReturn<T extends Entity> {
  entities: Map<string, CreatedEntity<T>>;
  isLoading: boolean;
  isFetchingMore: boolean;
  isSubscribed: boolean;
  error: Error | null;
  /** Whether data is stale and being refreshed after reconnect */
  isRefreshing: boolean;
  /** Fetch more entities (pagination) */
  fetchMore: () => Promise<void>;
  /** Has more pages to fetch */
  hasMore: boolean;
}

interface UseMutualSocketOptions {
  /** Number of records to fetch initially. Default: 20 */
  limit?: number;
  /** Skip initial HTTP fetch. Useful if you already have the data. Default: false */
  skipInitialFetch?: boolean;
}

interface UseMutualSocketReturn<T extends Entity> {
  mutuals: Map<string, unknown>; // Mutual<B, T>
  isLoading: boolean;
  isFetchingMore: boolean;
  isSubscribed: boolean;
  error: Error | null;
  isRefreshing: boolean;
  /** Fetch more mutuals (pagination) */
  fetchMore: () => Promise<void>;
  /** Has more pages to fetch */
  hasMore: boolean;
}

// Global WebSocket manager instance (singleton)
let globalWsManager: WebSocketManager | null = null;

export const initWebSocket = (wsManager: WebSocketManager) => {
  globalWsManager = wsManager;
};

export const getWebSocketManager = (): WebSocketManager | null => {
  return globalWsManager;
};

export const initWebSocketActions = (
  monoriseStore: MonoriseStore,
  httpActions: {
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
  const useWebSocketConnection = (): UseWebSocketConnectionReturn => {
    const [state, setState] = useState<ConnectionState>('disconnected');

    useEffect(() => {
      if (!globalWsManager) return;
      const unsubscribe = globalWsManager.onStateChange(setState);
      return unsubscribe;
    }, []);

    const connect = () => {
      globalWsManager?.connect();
    };

    const disconnect = () => {
      globalWsManager?.disconnect();
    };

    return { state, connect, disconnect };
  };

  /**
   * Subscribe to ALL changes of an entity type.
   * Automatically handles:
   - Initial fetch via HTTP
   - Real-time updates via WebSocket
   - Auto-refetch on reconnect after disconnect
   */
  const useEntitySocket = <T extends Entity>(
    entityType: T,
    opts: UseEntitySocketOptions = {},
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

    // Get current entities from store
    const entities = monoriseStore((state) => {
      const entityState = state.entity[entityType];
      return entityState?.dataMap || new Map();
    });

    // Fetch function (initial, more, or refresh)
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
        const result = await httpActions.listEntities(entityType, {
          limit,
          lastKey: fetchLastKey,
        });

        monoriseStore.setState((state) => {
          if (type === 'refresh') {
            // Clear and replace on refresh
            state.entity[entityType].dataMap.clear();
          }
          for (const entity of result.data) {
            state.entity[entityType].dataMap.set(entity.entityId, entity);
          }
          state.entity[entityType].isFirstFetched = true;
          state.entity[entityType].lastKey = result.lastKey || null;
        });

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

    // Initial fetch
    useEffect(() => {
      if (skipInitialFetch) return;
      fetchData('initial');
    }, [entityType, limit, skipInitialFetch]);

    // Subscribe to WebSocket and handle auto-refetch on reconnect
    useEffect(() => {
      if (!globalWsManager) {
        setIsSubscribed(false);
        return;
      }

      const subKey = globalWsManager.subscribeEntityType(entityType as string);
      setIsSubscribed(true);

      // Listen for connection state changes to detect reconnect
      let wasConnected = false;
      const unsubscribeState = globalWsManager.onStateChange((state) => {
        if (state === 'connected' && wasConnected === false && !isFirstFetchRef.current) {
          // Reconnected after being disconnected - auto refetch to catch up
          fetchData('refresh');
        }
        wasConnected = state === 'connected';
        isFirstFetchRef.current = false;
      });

      // Listen for server broadcasts
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

            if (payload.entityType !== entityType) return;

            if (msg.type === 'entity.created' || msg.type === 'entity.updated') {
              if (payload.data) {
                monoriseStore.setState((state) => {
                  state.entity[entityType].dataMap.set(
                    payload.entityId,
                    payload.data!,
                  );
                });
              }
            } else if (msg.type === 'entity.deleted') {
              monoriseStore.setState((state) => {
                state.entity[entityType].dataMap.delete(payload.entityId);
              });
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

    // Fetch more (pagination)
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

  /**
   * Subscribe to ALL mutuals of a type for a specific byEntity.
   * Automatically handles initial fetch, real-time updates, and auto-refetch on reconnect.
   */
  const useMutualSocket = <B extends Entity, T extends Entity>(
    byEntityType: B,
    byEntityId: string | undefined,
    mutualEntityType: T,
    opts: UseMutualSocketOptions = {},
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
      return state.mutual[mutualKey]?.dataMap || new Map();
    });

    // Fetch function
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
        const result = await httpActions.listEntitiesByEntity(
          byEntityType,
          byEntityId,
          mutualEntityType,
          { limit, lastKey: fetchLastKey },
        );

        monoriseStore.setState((state) => {
          if (!state.mutual[mutualKey]) {
            state.mutual[mutualKey] = {
              dataMap: new Map(),
              isFirstFetched: true,
              lastKey: null,
            };
          }
          if (type === 'refresh') {
            state.mutual[mutualKey].dataMap.clear();
          }
          for (const entity of result.entities) {
            const e = entity as any;
            state.mutual[mutualKey].dataMap.set(e.entityId, entity);
          }
          state.mutual[mutualKey].lastKey = result.lastKey || null;
        });

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

    // Initial fetch
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

    // Subscribe and handle auto-refetch
    useEffect(() => {
      if (!globalWsManager || !byEntityId) {
        setIsSubscribed(false);
        return;
      }

      const subKey = globalWsManager.subscribeMutualType(
        byEntityType as string,
        byEntityId,
        mutualEntityType as string,
      );
      setIsSubscribed(true);

      // Track connection for auto-refetch
      let wasConnected = false;
      const unsubscribeState = globalWsManager.onStateChange((state) => {
        if (state === 'connected' && wasConnected === false && !isFirstFetchRef.current) {
          fetchData('refresh');
        }
        wasConnected = state === 'connected';
        isFirstFetchRef.current = false;
      });

      // Listen for server broadcasts
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
              payload.byEntityType !== byEntityType ||
              payload.byEntityId !== byEntityId ||
              payload.mutualEntityType !== mutualEntityType
            ) {
              return;
            }

            if (
              msg.type === 'mutual.created' ||
              msg.type === 'mutual.updated'
            ) {
              if (payload.data) {
                monoriseStore.setState((state) => {
                  if (!state.mutual[mutualKey]) {
                    state.mutual[mutualKey] = {
                      dataMap: new Map(),
                      isFirstFetched: true,
                    };
                  }
                  state.mutual[mutualKey].dataMap.set(
                    payload.entityId,
                    payload.data!,
                  );
                });
              }
            } else if (msg.type === 'mutual.deleted') {
              monoriseStore.setState((state) => {
                state.mutual[mutualKey]?.dataMap.delete(payload.entityId);
              });
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

    // Fetch more
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

  return {
    useWebSocketConnection,
    useEntitySocket,
    useMutualSocket,
    initWebSocket,
    getWebSocketManager,
  };
};

export type WebSocketActions = ReturnType<typeof initWebSocketActions>;
