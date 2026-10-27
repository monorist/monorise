import {
  AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initAppActions } from '../../actions/app.action';
import { initMonoriseStore } from '../../store/monorise.store';
import { initAxiosInterceptor } from '../api';

type Reply = 'ok' | 'fail';

/** An axios harness whose adapter answers each request in turn from `replies`. */
const makeHarness = (replies: Reply[]) => {
  const { monoriseStore } = initMonoriseStore();
  const appActions = initAppActions(monoriseStore);
  const axios = initAxiosInterceptor(monoriseStore, appActions);
  let settle: (() => void) | undefined;
  const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    const reply = replies.shift() ?? 'ok';
    // Held open until the test settles it, so "in flight" is controllable.
    await new Promise<void>((resolve) => {
      settle = resolve;
    });
    if (reply === 'fail') {
      throw new AxiosError('Network Error', 'ERR_NETWORK', config);
    }
    return {
      config,
      data: { reply: adapter.mock.calls.length },
      headers: {},
      status: 200,
      statusText: 'OK',
    } satisfies AxiosResponse;
  });
  axios.defaults.adapter = adapter;

  const post = () =>
    axios.post('/core/entity/thing', {}, { requestKey: 'entity/create/thing' });
  const flush = async () => {
    await vi.waitFor(() => expect(settle).toBeDefined());
    const current = settle;
    settle = undefined;
    current?.();
  };
  return { adapter, post, flush, monoriseStore };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('request dedupe', () => {
  it('shares one request between concurrent calls with the same key', async () => {
    const { adapter, post, flush } = makeHarness(['ok']);

    const first = post();
    const second = post();
    await flush();

    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ status: 200 });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('sends a retry made right after a failure, instead of handing back the failure', async () => {
    const { adapter, post, flush } = makeHarness(['fail', 'ok']);

    const failed = post();
    await flush();
    await expect(failed).rejects.toThrow('Network Error');

    const retry = post();
    expect(retry).not.toBe(failed);
    await flush();
    await expect(retry).resolves.toMatchObject({ status: 200 });
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it("keeps sharing a retry once the failed request's loading signal ends", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { adapter, post, flush } = makeHarness(['fail', 'ok']);

    const failed = post();
    await flush();
    await expect(failed).rejects.toThrow('Network Error');

    const retry = post();
    // The failed request's endLoading timer fires while the retry is in flight.
    vi.advanceTimersByTime(500);
    expect(post()).toBe(retry);

    await flush();
    await expect(retry).resolves.toMatchObject({ status: 200 });
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it('forgets a request once it succeeds', async () => {
    const { adapter, post, flush, monoriseStore } = makeHarness(['ok', 'ok']);

    await Promise.all([post(), flush()]);
    expect(monoriseStore.getState().app.ongoingRequests.size).toBe(0);

    await Promise.all([post(), flush()]);
    expect(adapter).toHaveBeenCalledTimes(2);
  });
});
