import type { Entity } from '@monorise/base';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { initAppActions } from '../../actions/app.action';
import {
  type TransactionResult,
  transactional as tx,
} from '../../helpers/transactional';
import { initAxiosInterceptor } from '../../lib/api';
import { initMonoriseStore } from '../../store/monorise.store';
import initCoreService from '../core.service';

const SCORE = 'game-score' as unknown as Entity;

const makeHarness = () => {
  const { monoriseStore } = initMonoriseStore();
  const appActions = initAppActions(monoriseStore);
  const axios = initAxiosInterceptor(monoriseStore, appActions);
  let requestNumber = 0;
  const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    requestNumber += 1;
    return {
      config,
      data: {
        results: [
          {
            operation: 'adjustEntity',
            entityType: SCORE,
            entityId: `response-${requestNumber}`,
            data: {},
          },
        ],
      },
      headers: {},
      status: 200,
      statusText: 'OK',
    } satisfies AxiosResponse<TransactionResult>;
  });
  axios.defaults.adapter = adapter;

  return {
    adapter,
    coreService: initCoreService(monoriseStore, axios),
  };
};

const operations = [tx.adjustEntity(SCORE, 'game-1', { score: 1 })];

describe('executeTransaction request dedupe', () => {
  it('sends concurrent transactions with identical operations separately by default', async () => {
    const { adapter, coreService } = makeHarness();

    const first = coreService.executeTransaction(operations);
    const second = coreService.executeTransaction(operations);
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(adapter).toHaveBeenCalledTimes(2);
    expect(firstResponse).not.toBe(secondResponse);
    expect(
      new Set([
        firstResponse.data.results[0].entityId,
        secondResponse.data.results[0].entityId,
      ]),
    ).toEqual(new Set(['response-1', 'response-2']));
  });

  it('dedupes concurrent transactions that share an explicit request key', async () => {
    const { adapter, coreService } = makeHarness();
    const opts = { requestKey: 'transaction/intentional-dedupe' };

    const first = coreService.executeTransaction(operations, opts);
    const second = coreService.executeTransaction(operations, opts);
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(adapter).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(firstResponse).toBe(secondResponse);
    expect(firstResponse.data.results[0].entityId).toBe('response-1');
  });
});
