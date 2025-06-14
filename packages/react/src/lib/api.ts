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
    const { requestKey, isInterruptive = false, feedback } = config;
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
    code: 'UNKNOWN_EXCEPTION',
    message: "Ops, something doesn't seems right",
  };

  axios.interceptors.response.use(
    (response) => {
      const { requestKey, isInterruptive, feedback } = response.config;
      endLoading({ requestKey, isInterruptive });
      clearError(requestKey);

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
    (error: AxiosError<ApplicationRequestError>) => {
      const { requestKey, isInterruptive } = error.config as AxiosRequestConfig;
      endLoading({ requestKey, isInterruptive });
      setError({ requestKey, error: error.response?.data || unknownError });
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
