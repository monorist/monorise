import type {
  ConnectionState,
  CreatedEntity,
  Entity,
  ServerMessage,
  WebSocketManager,
} from '@monorise/core';
import { useCallback, useEffect, useState } from 'react';
import type { MonoriseStore } from '../store/monorise.store';

interface UseWebSocketConnectionReturn {
  state: ConnectionState;
  connect: () => void;
  disconnect: () => void;
}

interface UseEntitySocketOptions {
  /** Number of records to fetch initially. Set to 0 to skip initial fetch. Default: 20 */
  limit?: number;
  /** Skip initial HTTP fetch. Useful if you already have the data. Default: false */
  skipInitialFetch?: boolean;
}

interface UseEntitySocketReturn<T extends Entity> {
  entities: Map<string, CreatedEntity<T>>;
  isLoading: boolean;
  isSubscribed: boolean;
  error: Error | null;
  /** Fetch more entities (pagination) */
  fetchMore: () => Promise<void>;
  /** Refetch from beginning */
  refetch: () => Promise<void>;
}

interface UseMutualSocketOptions {
  /** Number of records to fetch initially. Set to 0 to skip initial fetch. Default: 20 */
  limit?: number;
  /** Skip initial HTTP fetch. Useful if you already have the data. Default: false */
  skipInitialFetch?: boolean;
}

interface UseMutualSocketReturn<T extends Entity> {
  mutuals: Map<string, unknown>; // Mutual<B, T>
  isLoading: boolean;
  isSubscribed: boolean;
  error: Error | null;
  /** Fetch more mutuals (pagination) */
  fetchMore: () => Promise<void>;
  /** Refetch from beginning */
  refetch: () => Promise<void>;
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
  // Need access to HTTP actions for initial fetch
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

    const connect = useCallback(() => {
      globalWsManager?.connect();
    }, []);

    const disconnect = useCallback(() => {
      globalWsManager?.disconnect();
    }, []);

    return { state, connect, disconnect };
  };

  /**
   * Subscribe to ALL changes of an entity type.
   * Fetches initial data via HTTP, then listens for real-time updates via WebSocket.
   */
  const useEntitySocket = <T extends Entity>(
    entityType: T,
    opts: UseEntitySocketOptions = {},
  ): UseEntitySocketReturn<T> => {
    const { limit = 20, skipInitialFetch = false } = opts;
    const [isLoading, setIsLoading] = useState(!skipInitialFetch);
    const [isSubscribed, setIsSubscribed] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [lastKey, setLastKey] = useState<string | undefined>();

    // Get current entities from store
    const entities = monoriseStore((state) => {
      const entityState = state.entity[entityType];
      return entityState?.dataMap || new Map();
    });

    // Initial fetch via HTTP
    useEffect(() => {
      if (skipInitialFetch) return;

      let cancelled = false;

      const fetchInitial = async () => {
        setIsLoading(true);
        setError(null);

        try {
          const result = await httpActions.listEntities(entityType, { limit });
          if (cancelled) return;

          // Store in Zustand
          monoriseStore.setState((state) => {
            for (const entity of result.data) {
              state.entity[entityType].dataMap.set(entity.entityId, entity);
            }
            state.entity[entityType].isFirstFetched = true;
            state.entity[entityType].lastKey = result.lastKey || null;
          });

          setLastKey(result.lastKey);
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err : new Error('Failed to fetch'));
          }
        } finally {
          if (!cancelled) {
            setIsLoading(false);
          }
        }
      };

      fetchInitial();

      return () => {
        cancelled = true;
      };
    }, [entityType, limit, skipInitialFetch]);

    // Subscribe to WebSocket for real-time updates
    useEffect(() => {
      if (!globalWsManager) {
        setIsSubscribed(false);
        return;
      }

      const subKey = globalWsManager.subscribeEntityType(entityType as string);
      setIsSubscribed(true);

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
        unsubscribeMessage();
        setIsSubscribed(false);
      };
    }, [entityType]);

    // Fetch more (pagination)
    const fetchMore = useCallback(async () => {
      if (!lastKey) return;

      setIsLoading(true);
      setError(null);

      try {
        const result = await httpActions.listEntities(entityType, {
          limit,
          lastKey,
        });

        monoriseStore.setState((state) => {
          for (const entity of result.data) {
            state.entity[entityType].dataMap.set(entity.entityId, entity);
          }
          state.entity[entityType].lastKey = result.lastKey || null;
        });

        setLastKey(result.lastKey);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch more'));
      } finally {
        setIsLoading(false);
      }
    }, [entityType, limit, lastKey]);

    // Refetch from beginning
    const refetch = useCallback(async () => {
      setIsLoading(true);
      setError(null);
      setLastKey(undefined);

      try {
        const result = await httpActions.listEntities(entityType, { limit });

        monoriseStore.setState((state) => {
          // Clear and refill
          state.entity[entityType].dataMap.clear();
          for (const entity of result.data) {
            state.entity[entityType].dataMap.set(entity.entityId, entity);
          }
          state.entity[entityType].lastKey = result.lastKey || null;
        });

        setLastKey(result.lastKey);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to refetch'));
      } finally {
        setIsLoading(false);
      }
    }, [entityType, limit]);

    return { entities, isLoading, isSubscribed, error, fetchMore, refetch };
  };

  /**
   * Subscribe to ALL mutuals of a type for a specific byEntity.
   * Fetches initial data via HTTP, then listens for real-time updates via WebSocket.
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
    const [isSubscribed, setIsSubscribed] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [lastKey, setLastKey] = useState<string | undefined>();

    const mutualKey = byEntityId
      ? `${byEntityType}/${byEntityId}/${mutualEntityType}`
      : '';

    const mutuals = monoriseStore((state) => {
      return state.mutual[mutualKey]?.dataMap || new Map();
    });

    // Initial fetch via HTTP
    useEffect(() => {
      if (skipInitialFetch || !byEntityId) {
        setIsLoading(false);
        return;
      }

      let cancelled = false;

      const fetchInitial = async () => {
        setIsLoading(true);
        setError(null);

        try {
          const result = await httpActions.listEntitiesByEntity(
            byEntityType,
            byEntityId,
            mutualEntityType,
            { limit },
          );
          if (cancelled) return;

          // Store in Zustand
          monoriseStore.setState((state) => {
            if (!state.mutual[mutualKey]) {
              state.mutual[mutualKey] = {
                dataMap: new Map(),
                isFirstFetched: true,
                lastKey: result.lastKey || null,
              };
            }
            for (const entity of result.entities) {
              const e = entity as any;
              state.mutual[mutualKey].dataMap.set(e.entityId, entity);
            }
          });

          setLastKey(result.lastKey);
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err : new Error('Failed to fetch'));
          }
        } finally {
          if (!cancelled) {
            setIsLoading(false);
          }
        }
      };

      fetchInitial();

      return () => {
        cancelled = true;
      };
    }, [byEntityType, byEntityId, mutualEntityType, limit, skipInitialFetch]);

    // Subscribe to WebSocket for real-time updates
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
        unsubscribeMessage();
        setIsSubscribed(false);
      };
    }, [byEntityType, byEntityId, mutualEntityType, mutualKey]);

    // Fetch more (pagination)
    const fetchMore = useCallback(async () => {
      if (!lastKey || !byEntityId) return;

      setIsLoading(true);
      setError(null);

      try {
        const result = await httpActions.listEntitiesByEntity(
          byEntityType,
          byEntityId,
          mutualEntityType,
          { limit, lastKey },
        );

        monoriseStore.setState((state) => {
          if (!state.mutual[mutualKey]) {
            state.mutual[mutualKey] = { dataMap: new Map(), isFirstFetched: true };
          }
          for (const entity of result.entities) {
            const e = entity as any;
            state.mutual[mutualKey].dataMap.set(e.entityId, entity);
          }
          state.mutual[mutualKey].lastKey = result.lastKey || null;
        });

        setLastKey(result.lastKey);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch more'));
      } finally {
        setIsLoading(false);
      }
    }, [byEntityType, byEntityId, mutualEntityType, limit, lastKey]);

    // Refetch from beginning
    const refetch = useCallback(async () => {
      if (!byEntityId) return;

      setIsLoading(true);
      setError(null);
      setLastKey(undefined);

      try {
        const result = await httpActions.listEntitiesByEntity(
          byEntityType,
          byEntityId,
          mutualEntityType,
          { limit },
        );

        monoriseStore.setState((state) => {
          if (!state.mutual[mutualKey]) {
            state.mutual[mutualKey] = { dataMap: new Map(), isFirstFetched: true };
          }
          state.mutual[mutualKey].dataMap.clear();
          for (const entity of result.entities) {
            const e = entity as any;
            state.mutual[mutualKey].dataMap.set(e.entityId, entity);
          }
          state.mutual[mutualKey].lastKey = result.lastKey || null;
        });

        setLastKey(result.lastKey);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to refetch'));
      } finally {
        setIsLoading(false);
      }
    }, [byEntityType, byEntityId, mutualEntityType, limit]);

    return { mutuals, isLoading, isSubscribed, error, fetchMore, refetch };
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
