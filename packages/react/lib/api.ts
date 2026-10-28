import request, {
  type AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios';
import type { AppActions } from '../actions/app.action';
import type { AuthActions } from '../actions/auth.action';
import type { MonoriseStore } from '../store/monorise.store';
import type { ApplicationRequestError } from '../types/api.type';

type IntercepterAxiosRequestConfig<D> = AxiosRequestConfig<D> & {
  requestKey: string;
  stateKeys?: string[];
  isInterruptive?: boolean;
  feedback?: {
    loading?: string | boolean;
    success?: ((data: any) => string) | string | boolean;
    failure?: string | boolean;
  };
};

const initAxiosInterceptor = (store: MonoriseStore, appActions: AppActions) => {
  const { startLoading } = appActions;

  const axiosInstance = request.create();

  function makeRequest<T = any, R = AxiosResponse<T, any>, D = any>(
    url: string,
    config: AxiosRequestConfig<D>,
    data?: D,
  ): Promise<R> {
    const {
      requestKey,
      stateKeys = [],
      isInterruptive = false,
      feedback,
    } = config;
    const { ongoingRequests } = store.getState().app;

    if (ongoingRequests.has(requestKey)) {
      return ongoingRequests.get(requestKey) as Promise<R>;
    }

    const promise = axiosInstance.request<T, R, D>({
      ...config,
      url,
      data,
      headers: {
        ...(config.headers || {}),
        'Mr-Interruptive': String(isInterruptive),
      },
    });
    startLoading({
      requestKey,
      isInterruptive,
      message: feedback?.loading,
      request: promise,
    });
    for (const stateKey of new Set(stateKeys)) {
      if (stateKey !== requestKey) {
        // State keys are loading/error observers only. Registering the request
        // under them would make a different write to the same target dedupe.
        startLoading({
          requestKey: stateKey,
          isInterruptive,
          message: feedback?.loading,
        });
      }
    }

    return promise;
  }

  const axios = {
    ...axiosInstance,
    post: <T = any, R = AxiosResponse<T, any>, D = any>(
      url: string,
      data: D,
      config: IntercepterAxiosRequestConfig<D>,
    ): Promise<R> => makeRequest(url, { ...config, method: 'POST' }, data),
    put: <T = any, R = AxiosResponse<T, any>, D = any>(
      url: string,
      data: D,
      config: IntercepterAxiosRequestConfig<D>,
    ): Promise<R> => makeRequest(url, { ...config, method: 'PUT' }, data),
    patch: <T = any, R = AxiosResponse<T, any>, D = any>(
      url: string,
      data: D,
      config: IntercepterAxiosRequestConfig<D>,
    ): Promise<R> => makeRequest(url, { ...config, method: 'PATCH' }, data),
    delete: <T = any, R = AxiosResponse<T, any>, D = any>(
      url: string,
      config: IntercepterAxiosRequestConfig<D>,
    ): Promise<R> => makeRequest(url, { ...config, method: 'DELETE' }),
    get: <T = any, R = AxiosResponse<T, any>, D = any>(
      url: string,
      config: IntercepterAxiosRequestConfig<D>,
    ): Promise<R> => makeRequest(url, { ...config, method: 'GET' }),
  };

  return axios;
};

type ConfigOptions = {
  onApiSuccess?: <T>(
    response: AxiosResponse<T>,
    feedbackSuccess:
      | ((data: AxiosResponse<T>['data']) => React.ReactNode)
      | string
      | boolean,
  ) => void;
};

const injectAxiosInterceptor = (
  appActions: AppActions,
  authActions: AuthActions,
  axios: ReturnType<typeof initAxiosInterceptor>,
  opts?: ConfigOptions,
) => {
  let options: ConfigOptions = opts || {};
  const { endLoading, setError, clearError } = appActions;
  const { setIsUnauthorized } = authActions;

  const unknownError: ApplicationRequestError = {
    status: 500,
    code: 'UNKNOWN_EXCEPTION',
    message: "Ops, something doesn't seems right",
  };

  const settleLoading = (config: AxiosRequestConfig) => {
    const { requestKey, stateKeys = [], isInterruptive } = config;
    endLoading({ requestKey, isInterruptive });
    for (const stateKey of new Set(stateKeys)) {
      if (stateKey !== requestKey) {
        endLoading({
          requestKey: stateKey,
          isInterruptive,
          skipDedupe: true,
        });
      }
    }
  };

  const getErrorKeys = (config: AxiosRequestConfig) => {
    const { requestKey, stateKeys = [] } = config;
    return stateKeys.length > 0 ? new Set(stateKeys) : new Set([requestKey]);
  };

  axios.interceptors.response.use(
    (response) => {
      const { feedback } = response.config;
      settleLoading(response.config);
      for (const errorKey of getErrorKeys(response.config)) {
        clearError(errorKey);
      }

      if (feedback?.success) {
        options.onApiSuccess?.(response, feedback.success);
      }
      // switch (typeof feedback.success) {
      //   case 'function':
      //     toast(feedback.success(response.data));
      //     break;
      //   case 'string':
      //     toast(
      //       <Fragment>
      //         <IconCircleCheckFilled color='rgb(34 197 94)' />
      //         {feedback.success}
      //       </Fragment>,
      //     );
      //     break;
      //   case 'boolean':
      //     toast('Request success');
      //     break;
      // }

      return Promise.resolve(response);
    },
    (error: AxiosError<string>) => {
      const config = error.config as AxiosRequestConfig;
      settleLoading(config);

      const appError = error.response?.data
        ? {
            code: error.response?.statusText,
            status: error.response?.status,
            message: error.response?.data,
          }
        : unknownError;
      for (const errorKey of getErrorKeys(config)) {
        setError({ requestKey: errorKey, error: appError });
      }
      if (error.response?.status === 401) {
        setIsUnauthorized(true);
      }
      return Promise.reject(error);
    },
  );

  const setOptions = (opts: ConfigOptions) => {
    options = {
      ...options,
      ...opts,
    };
  };

  return { setOptions };
};

export { initAxiosInterceptor, injectAxiosInterceptor };
