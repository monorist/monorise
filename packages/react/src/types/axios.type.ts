// types/axios.d.ts
import 'axios';

declare module 'axios' {
  export interface AxiosRequestConfig {
    requestKey: string;
    isInterruptive?: boolean;
    feedback?: {
      loading?: string | boolean;
      success?: ((data: any) => string) | string | boolean;
      failure?: string | boolean;
    };
  }
}
