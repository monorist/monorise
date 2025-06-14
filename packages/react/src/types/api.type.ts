import request, { type AxiosRequestConfig, type AxiosResponse } from 'axios';

export type ApplicationRequestError = {
  code: string;
  message: string;
};

type ExtractModalProps<T> = T extends React.ComponentType<infer P> ? P : void;

// Dynamically generate ModalProps
export type ModalProps<M> = {
  [K in keyof M]: ExtractModalProps<M[K]>;
};

// this axios instance is created for the sole purpose of typing
// why not using typeof initAxiosInterceptor?
// To break circular dependency

const axiosInstance = request.create();

function makeRequest<T = any, R = AxiosResponse<T, any>, D = any>(
  url: string,
  config: AxiosRequestConfig<D>,
  data?: D,
): Promise<R> {
  const promise = axiosInstance.request<T, R, D>({ ...config, url, data });
  return promise;
}

const axios = {
  ...axiosInstance,
  post: <T = any, R = AxiosResponse<T, any>, D = any>(
    url: string,
    data: D,
    config: AxiosRequestConfig<D>,
  ): Promise<R> => makeRequest(url, { ...config, method: 'POST' }, data),
  put: <T = any, R = AxiosResponse<T, any>, D = any>(
    url: string,
    data: D,
    config: AxiosRequestConfig<D>,
  ): Promise<R> => makeRequest(url, { ...config, method: 'PUT' }, data),
  patch: <T = any, R = AxiosResponse<T, any>, D = any>(
    url: string,
    data: D,
    config: AxiosRequestConfig<D>,
  ): Promise<R> => makeRequest(url, { ...config, method: 'PATCH' }, data),
  delete: <T = any, R = AxiosResponse<T, any>, D = any>(
    url: string,
    config: AxiosRequestConfig<D>,
  ): Promise<R> => makeRequest(url, { ...config, method: 'DELETE' }),
  get: <T = any, R = AxiosResponse<T, any>, D = any>(
    url: string,
    config: AxiosRequestConfig<D>,
  ): Promise<R> => makeRequest(url, { ...config, method: 'GET' }),
};

export type AxiosInterceptor = typeof axios;
