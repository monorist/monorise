import type { CreatedEntity, Entity } from '@monorise/base';
import { useCallback, useEffect, useState } from 'react';
import { produce } from 'immer';
import type { MonoriseStore } from '../store/monorise.store';
import type {
  ConnectionState,
  ServerMessage,
  WebSocketManager,
} from '../websocket';

export interface UseWebSocketConnectionReturn {
  state: ConnectionState;
  connect: () => void;
  disconnect: () => void;
}

// Global WebSocket manager instance (singleton)
let globalWsManager: WebSocketManager | null = null;

export const initWebSocket = (wsManager: WebSocketManager) => {
  globalWsManager = wsManager;
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

  /**
   * Subscribe to ALL changes of an entity type.
   * Server will send: entity.created, entity.updated, entity.deleted events
   */
  const useEntitySocket = <T extends Entity>(
    entityType: T,
  ): {
    entities: Map<string, CreatedEntity<T>>;
    isSubscribed: boolean;
  } => {
    const [isSubscribed, setIsSubscribed] = useState(false);

    // Get current entities from store
    const entities = monoriseStore((state) => {
      const entityState = state.entity[entityType];
      return entityState?.dataMap || new Map();
    });

    useEffect(() => {
      if (!globalWsManager) {
        setIsSubscribed(false);
        return;
      }

      // Subscribe to ALL changes of this entity type
      const subKey = globalWsManager.subscribeEntityType(entityType as unknown as string);
      setIsSubscribed(true);

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

            // Only process if it's our entity type
            if (payload.entityType !== (entityType as unknown as string)) return;

            if (msg.type === 'entity.created' || msg.type === 'entity.updated') {
              if (payload.data) {
                monoriseStore.setState(
                  produce((state) => {
                    state.entity[entityType as unknown as string].dataMap.set(
                      payload.entityId,
                      payload.data!,
                    );
                  }),
                );
              }
            } else if (msg.type === 'entity.deleted') {
              monoriseStore.setState(
                produce((state) => {
                  state.entity[entityType as unknown as string].dataMap.delete(payload.entityId);
                }),
              );
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

    return { entities, isSubscribed };
  };

  /**
   * Subscribe to ALL mutuals of a type for a specific byEntity.
   * Similar to listEntitiesByEntity but with real-time updates.
   * Server will send: mutual.created, mutual.updated, mutual.deleted events
   */
  const useMutualSocket = <B extends Entity, T extends Entity>(
    byEntityType: B,
    byEntityId: string | undefined,
    mutualEntityType: T,
  ): {
    mutuals: Map<string, unknown>; // Mutual<B, T>
    isSubscribed: boolean;
  } => {
    const [isSubscribed, setIsSubscribed] = useState(false);

    const mutualKey = byEntityId
      ? `${byEntityType}/${byEntityId}/${mutualEntityType}`
      : '';

    const mutuals = monoriseStore((state) => {
      return state.mutual[mutualKey]?.dataMap || new Map();
    });

    useEffect(() => {
      if (!globalWsManager || !byEntityId) {
        setIsSubscribed(false);
        return;
      }

      // Subscribe to ALL mutuals of this type for the byEntity
      const subKey = globalWsManager.subscribeMutualType(
        byEntityType as unknown as string,
        byEntityId,
        mutualEntityType as unknown as string,
      );
      setIsSubscribed(true);

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

            // Only process if it matches our subscription
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
        unsubscribeMessage();
        setIsSubscribed(false);
      };
    }, [byEntityType, byEntityId, mutualEntityType, mutualKey]);

    return { mutuals, isSubscribed };
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
