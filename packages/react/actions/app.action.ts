import { produce } from 'immer';
import { useEffect, useState } from 'react';
import type { MonoriseStore } from '../store/monorise.store';
import type { ApplicationRequestError, ModalProps } from '../types/api.type';

type StartLoadingPayload<T> = {
  requestKey: string;
  isInterruptive?: boolean;
  message?: string | boolean;
  // Omit when this key is one of several sharing a single real HTTP call
  // (e.g. executeTransaction driving a loading signal per operation) — passing
  // it registers `requestKey` in `ongoingRequests`, which lib/api.ts's
  // `makeRequest` uses to hand back an in-flight promise to ANY other caller
  // using that same key, even one making a structurally different request.
  // The entry lasts only while `request` is in flight: once it settles, the
  // next call with the key (a retry after a failure, say) is sent afresh.
  request?: Promise<T>;
};

type EndLoadingPayload = {
  requestKey: string;
  isInterruptive?: boolean;
  /**
   * @deprecated No longer needed: endLoading no longer touches
   * `ongoingRequests`; startLoading drops a request from it when the request
   * settles.
   */
  skipDedupe?: boolean;
};

type SetErrorPayload = {
  requestKey: string;
  error: ApplicationRequestError;
};

type Options = {
  modals?: Record<string, React.ComponentType<unknown>>;
};

const initAppActions = (store: MonoriseStore) => {
  let options: Options = {};

  const { modals = {} } = options;
  type AppModalProps = ModalProps<typeof modals>;

  const startLoading = <T>({
    requestKey,
    isInterruptive,
    message,
    request,
  }: StartLoadingPayload<T>) => {
    store.setState(
      produce((state) => {
        const stackType = isInterruptive ? 'intLoadStack' : 'loadStack';
        const requestKeyCount = state.app[stackType].get(requestKey);

        state.app.loadingMessage =
          typeof message === 'string' ? message : 'Loading';
        if (request) {
          state.app.ongoingRequests.set(requestKey, request);
        }
        state.app[stackType].set(
          requestKey,
          requestKeyCount ? requestKeyCount + 1 : 1,
        );
      }),
      undefined,
      `mr/start-loading/${requestKey}`,
    );

    if (request) {
      // Share the request only while it's in flight. Checked by identity, so
      // a newer request under the same key is never the one removed.
      const forget = () => {
        if (store.getState().app.ongoingRequests.get(requestKey) !== request) {
          return;
        }
        store.setState(
          produce((state) => {
            state.app.ongoingRequests.delete(requestKey);
          }),
          undefined,
          `mr/settle-request/${requestKey}`,
        );
      };
      request.then(forget, forget);
    }
  };

  const endLoading = ({ requestKey, isInterruptive }: EndLoadingPayload) => {
    // The loading signal lingers briefly so it doesn't flicker. Request
    // dedupe isn't touched here: by now a retry may already be in flight
    // under the same key.
    setTimeout(() => {
      store.setState(
        produce((state) => {
          const stackType = isInterruptive ? 'intLoadStack' : 'loadStack';
          const requestKeyCount = state.app[stackType].get(requestKey);

          if (typeof requestKeyCount === 'number' && requestKeyCount > 1) {
            state.app[stackType].set(requestKey, requestKeyCount - 1);
          } else {
            state.app[stackType].delete(requestKey);
          }
        }),
        undefined,
        `mr/end-loading/${requestKey}`,
      );
    }, 500);
  };

  const checkIsLoading = (requestKey?: string) => {
    const { intLoadStack, loadStack } = store.getState().app;
    if (!requestKey) {
      return intLoadStack.size > 0 || loadStack.size > 0;
    }

    const activeIntLoadingCount = intLoadStack.get(requestKey);
    const isIntLoading =
      typeof activeIntLoadingCount === 'number' && activeIntLoadingCount > 0;

    const activeLoadingCount = loadStack.get(requestKey);
    const isLoading =
      typeof activeLoadingCount === 'number' && activeLoadingCount > 0;

    return isIntLoading || isLoading;
  };

  const setError = ({ requestKey, error }: SetErrorPayload) =>
    store.setState(
      produce((state) => {
        state.app.errorStack.set(requestKey, error);
      }),
      undefined,
      `mr/set-error/${requestKey}`,
    );

  const getError = (requestKey: string) => {
    const { errorStack } = store.getState().app;
    return errorStack.get(requestKey);
  };

  const clearError = (requestKey: string) => {
    const { errorStack } = store.getState().app;

    if (errorStack.has(requestKey)) {
      store.setState(
        produce((state) => {
          state.app.errorStack.delete(requestKey);
        }),
        undefined,
        `mr/clear-error/${requestKey}`,
      );
    }
  };

  const openModal = (modal: {
    name: keyof AppModalProps;
    context?: AppModalProps[keyof AppModalProps];
  }) =>
    store.setState(
      produce((state) => {
        state.app.modal = modal;
      }),
      undefined,
      `mr/open-modal/${modal.name}`,
    );

  const closeModal = () =>
    store.setState(
      produce((state) => {
        state.app.modal = { name: null };
      }),
      undefined,
      'mr/close-modal',
    );

  const useLoadStore = (requestKey?: string) => {
    const { loadStack, intLoadStack } = store((state) => ({
      loadStack: state.app.loadStack,
      intLoadStack: state.app.intLoadStack,
    }));
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
      if (loadStack && intLoadStack && requestKey) {
        setIsLoading(checkIsLoading(requestKey));
      }
    }, [loadStack, intLoadStack, requestKey]);

    return isLoading;
  };

  const useInterruptiveLoadStore = () => {
    const { intLoadStack, loadingMessage } = store((state) => ({
      intLoadStack: state.app.intLoadStack,
      loadingMessage: state.app.loadingMessage,
    }));

    return {
      isLoading: intLoadStack.size > 0,
      message: loadingMessage,
    };
  };

  const useErrorStore = (requestKey: string) => {
    const error = store((state) => state.app.errorStack.get(requestKey));

    useEffect(() => {
      if (error) {
        return () => {
          clearError(requestKey);
        };
      }
    }, [error, requestKey]);

    return error;
  };

  const useModalStore = () => {
    return store((state) => state.app.modal);
  };

  const setOptions = (opts: Options) => {
    options = {
      ...options,
      ...opts,
    };
  };

  return {
    startLoading,
    endLoading,
    setError,
    getError,
    clearError,
    openModal,
    closeModal,
    checkIsLoading,
    useLoadStore,
    useInterruptiveLoadStore,
    useErrorStore,
    useModalStore,
    setOptions,
  };
};

export { initAppActions };

export type AppActions = ReturnType<typeof initAppActions>;
