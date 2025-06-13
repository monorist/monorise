import type { Entity } from '@monorise/base';
import type { AxiosInterceptor } from '../types/api.type';

type LoginPayload = {
  email: string;
};

type Options = {
  apiBaseUrl?: string;
};

const initAuthService = (axios: AxiosInterceptor) => {
  let options: Options = {};
  const { apiBaseUrl = '/api/auth' } = options;

  const requestLoginMagicLink = (entityType: Entity, payload: LoginPayload) => {
    return axios.post(
      `${apiBaseUrl}/${entityType}`,
      {
        body: { ...payload },
      },
      {
        requestKey: `auth/${entityType}/request-login`,
        isInterruptive: true,
        feedback: {
          loading: 'Requesting login link',
        },
      },
    );
  };

  const getSessionProfile = <T extends Record<string, unknown>>() =>
    axios.get<
      T & {
        displayName: string;
        email: string;
        accountId: string;
      }
    >('/session', {
      requestKey: 'auth/session',
    });

  const logout = () =>
    axios.get('/logout', {
      requestKey: 'auth/logout',
    });

  const setOptions = (opts: Options) => {
    options = {
      ...options,
      ...opts,
    };
  };

  return {
    requestLoginMagicLink,
    getSessionProfile,
    logout,
    setOptions,
  };
};

export default initAuthService;

export type AuthService = ReturnType<typeof initAuthService>;
