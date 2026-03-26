import type {
  ClientMessage,
  ConnectionState,
  CreatedEntity,
  DraftEntity,
  Entity,
  ServerMessage,
  WebSocketManager,
} from '@monorise/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MonoriseStore } from '../store/monorise.store';

interface UseWebSocketConnectionReturn {
  state: ConnectionState;
  connect: () => void;
  disconnect: () => void;
}

interface UseEntitySocketReturn<T extends Entity> {
  entity: CreatedEntity<T> | undefined;
  isSubscribed: boolean;
}

interface UseMutualSocketReturn<B extends Entity, T extends Entity> {
  mutual: unknown | undefined; // Mutual<B, T>
  isSubscribed: boolean;
}

interface MutationResult {
  mutate: (data: unknown) => void;
  isPending: boolean;
  error: Error | null;
  isOptimistic: boolean;
}

// Global WebSocket manager instance (singleton)
let globalWsManager: WebSocketManager | null = null;
let globalWsUrl: string | null = null;

export const initWebSocket = (wsManager: WebSocketManager, url: string) => {
  globalWsManager = wsManager;
  globalWsUrl = url;
};

export const getWebSocketManager = (): WebSocketManager | null => {
  return globalWsManager;
};

export const initWebSocketActions = (monoriseStore: MonoriseStore) => {
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

  const useEntitySocket = <T extends Entity>(
    entityType: T,
    entityId: string | undefined,
  ): UseEntitySocketReturn<T> => {
    const [isSubscribed, setIsSubscribed] = useState(false);
    const entity = monoriseStore((state) =>
      entityId ? state.entity[entityType]?.dataMap.get(entityId) : undefined,
    );

    useEffect(() => {
      if (!globalWsManager || !entityId) {
        setIsSubscribed(false);
        return;
      }

      const subKey = globalWsManager.subscribe({
        entityType: entityType as string,
        entityId,
      });
      setIsSubscribed(true);

      return () => {
        globalWsManager?.unsubscribe(subKey);
        setIsSubscribed(false);
      };
    }, [entityType, entityId]);

    return { entity, isSubscribed };
  };

  const useMutualSocket = <B extends Entity, T extends Entity>(
    byEntityType: B,
    byEntityId: string | undefined,
    entityType: T,
    entityId: string | undefined,
  ): UseMutualSocketReturn<B, T> => {
    const [isSubscribed, setIsSubscribed] = useState(false);
    const mutualKey = byEntityId
      ? `${byEntityType}/${byEntityId}/${entityType}`
      : '';

    const mutual = monoriseStore((state) =>
      entityId && mutualKey
        ? state.mutual[mutualKey]?.dataMap.get(entityId)
        : undefined,
    );

    useEffect(() => {
      if (!globalWsManager || !byEntityId || !entityId) {
        setIsSubscribed(false);
        return;
      }

      const subKey = globalWsManager.subscribe({
        byEntityType: byEntityType as string,
        byEntityId,
        entityType: entityType as string,
        entityId,
      });
      setIsSubscribed(true);

      return () => {
        globalWsManager?.unsubscribe(subKey);
        setIsSubscribed(false);
      };
    }, [byEntityType, byEntityId, entityType, entityId]);

    return { mutual, isSubscribed };
  };

  // Mutation hooks with optimistic updates
  const useCreateEntitySocket = <T extends Entity>(
    entityType: T,
  ): MutationResult => {
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [isOptimistic, setIsOptimistic] = useState(false);
    const pendingRef = useRef<Map<string, () => void>>(new Map());

    const mutate = useCallback(
      (data: DraftEntity<T>) => {
        if (!globalWsManager) {
          setError(new Error('WebSocket not initialized'));
          return;
        }

        setIsPending(true);
        setError(null);
        setIsOptimistic(true);

        // Optimistic update
        const tempId = `temp-${Date.now()}`;
        monoriseStore.setState((state) => {
          state.entity[entityType].dataMap.set(tempId, {
            entityId: tempId,
            entityType,
            data,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isOptimistic: true,
          } as CreatedEntity<T>);
        });

        // Send via WebSocket
        const message: ClientMessage = {
          action: 'mutate',
          id: tempId,
          payload: {
            entityType: entityType as string,
            data,
          },
        };

        globalWsManager.send(message);

        // Store rollback function
        pendingRef.current.set(tempId, () => {
          monoriseStore.setState((state) => {
            state.entity[entityType].dataMap.delete(tempId);
          });
        });

        // Listen for confirmation
        const unsubscribe = globalWsManager.onMessage((msg: ServerMessage) => {
          if (msg.id === tempId) {
            setIsPending(false);
            setIsOptimistic(false);

            if (msg.type === 'error') {
              // Rollback
              pendingRef.current.get(tempId)?.();
              setError(new Error((msg.payload as { message: string }).message));
            }

            pendingRef.current.delete(tempId);
            unsubscribe();
          }
        });
      },
      [entityType],
    );

    return { mutate, isPending, error, isOptimistic };
  };

  const useUpdateEntitySocket = <T extends Entity>(
    entityType: T,
    entityId: string | undefined,
  ): MutationResult => {
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [isOptimistic, setIsOptimistic] = useState(false);
    const pendingRef = useRef<Map<string, () => void>>(new Map());

    const mutate = useCallback(
      (data: Partial<DraftEntity<T>>) => {
        if (!globalWsManager || !entityId) {
          setError(new Error('WebSocket not initialized or missing entityId'));
          return;
        }

        setIsPending(true);
        setError(null);
        setIsOptimistic(true);

        // Store previous data for rollback
        const previousData = monoriseStore.getState().entity[entityType].dataMap.get(entityId);

        // Optimistic update
        monoriseStore.setState((state) => {
          const existing = state.entity[entityType].dataMap.get(entityId);
          if (existing) {
            state.entity[entityType].dataMap.set(entityId, {
              ...existing,
              data: { ...existing.data, ...data },
              updatedAt: new Date().toISOString(),
              isOptimistic: true,
            });
          }
        });

        const message: ClientMessage = {
          action: 'mutate',
          id: `update-${entityId}-${Date.now()}`,
          payload: {
            entityType: entityType as string,
            entityId,
            data,
          },
        };

        globalWsManager.send(message);

        // Store rollback function
        const mutationId = message.id;
        pendingRef.current.set(mutationId, () => {
          if (previousData) {
            monoriseStore.setState((state) => {
              state.entity[entityType].dataMap.set(entityId, previousData);
            });
          }
        });

        const unsubscribe = globalWsManager.onMessage((msg: ServerMessage) => {
          if (msg.id === mutationId) {
            setIsPending(false);
            setIsOptimistic(false);

            if (msg.type === 'error') {
              pendingRef.current.get(mutationId)?.();
              setError(new Error((msg.payload as { message: string }).message));
            }

            pendingRef.current.delete(mutationId);
            unsubscribe();
          }
        });
      },
      [entityType, entityId],
    );

    return { mutate, isPending, error, isOptimistic };
  };

  const useDeleteEntitySocket = <T extends Entity>(
    entityType: T,
    entityId: string | undefined,
  ): MutationResult => {
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [isOptimistic, setIsOptimistic] = useState(false);
    const pendingRef = useRef<Map<string, () => void>>(new Map());

    const mutate = useCallback(() => {
      if (!globalWsManager || !entityId) {
        setError(new Error('WebSocket not initialized or missing entityId'));
        return;
      }

      setIsPending(true);
      setError(null);
      setIsOptimistic(true);

      // Store previous data for rollback
      const previousData = monoriseStore
        .getState()
        .entity[entityType].dataMap.get(entityId);

      // Optimistic delete
      monoriseStore.setState((state) => {
        state.entity[entityType].dataMap.delete(entityId);
      });

      const message: ClientMessage = {
        action: 'mutate',
        id: `delete-${entityId}-${Date.now()}`,
        payload: {
          entityType: entityType as string,
          entityId,
        },
      };

      globalWsManager.send(message);

      // Store rollback function
      const mutationId = message.id;
      pendingRef.current.set(mutationId, () => {
        if (previousData) {
          monoriseStore.setState((state) => {
            state.entity[entityType].dataMap.set(entityId, previousData);
          });
        }
      });

      const unsubscribe = globalWsManager.onMessage((msg: ServerMessage) => {
        if (msg.id === mutationId) {
          setIsPending(false);
          setIsOptimistic(false);

          if (msg.type === 'error') {
            pendingRef.current.get(mutationId)?.();
            setError(new Error((msg.payload as { message: string }).message));
          }

          pendingRef.current.delete(mutationId);
          unsubscribe();
        }
      });
    }, [entityType, entityId]);

    return { mutate, isPending, error, isOptimistic };
  };

  // Placeholder mutual mutation hooks
  const useCreateMutualSocket = (): MutationResult => {
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [isOptimistic, setIsOptimistic] = useState(false);

    const mutate = useCallback(() => {
      // Implementation similar to useCreateEntitySocket
      console.warn('useCreateMutualSocket not fully implemented');
    }, []);

    return { mutate, isPending, error, isOptimistic };
  };

  const useUpdateMutualSocket = (): MutationResult => {
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [isOptimistic, setIsOptimistic] = useState(false);

    const mutate = useCallback(() => {
      console.warn('useUpdateMutualSocket not fully implemented');
    }, []);

    return { mutate, isPending, error, isOptimistic };
  };

  const useDeleteMutualSocket = (): MutationResult => {
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [isOptimistic, setIsOptimistic] = useState(false);

    const mutate = useCallback(() => {
      console.warn('useDeleteMutualSocket not fully implemented');
    }, []);

    return { mutate, isPending, error, isOptimistic };
  };

  return {
    useWebSocketConnection,
    useEntitySocket,
    useMutualSocket,
    useCreateEntitySocket,
    useUpdateEntitySocket,
    useDeleteEntitySocket,
    useCreateMutualSocket,
    useUpdateMutualSocket,
    useDeleteMutualSocket,
    initWebSocket,
    getWebSocketManager,
  };
};

export type WebSocketActions = ReturnType<typeof initWebSocketActions>;
