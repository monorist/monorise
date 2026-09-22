import { describe, expect, it, vi } from 'vitest';

import { broadcastToFeedSubscribers } from './websocket-processor';

/**
 * Regression coverage for feed fan-out.
 *
 * The subject of a feed is always a candidate recipient of its own changes.
 * An earlier version returned as soon as `queryMutualConnections` came back
 * empty, which happened before the subject was added to the recipient set --
 * so a subscriber watching an entity with no mutual connections received
 * nothing at all, with no error anywhere to indicate it.
 */
const message = { type: 'entity.updated' } as never;

function makeManagementApi() {
  return { send: vi.fn().mockResolvedValue(undefined) };
}

function makeWsRepo(opts: {
  mutualConnections?: { entityType: string; entityId: string }[];
  feedSubs: Record<
    string,
    { connectionId: string; feedTypes?: string[] }[] | undefined
  >;
}) {
  return {
    queryMutualConnections: vi
      .fn()
      .mockResolvedValue(opts.mutualConnections ?? []),
    queryFeedSubscriptions: vi
      .fn()
      .mockImplementation(async (entityType: string, entityId: string) =>
        opts.feedSubs[`${entityType}:${entityId}`] ?? [],
      ),
    deleteSubscription: vi.fn().mockResolvedValue(undefined),
  };
}

describe('broadcastToFeedSubscribers', () => {
  it('delivers to a subscriber whose subject has no mutual connections', async () => {
    const managementApi = makeManagementApi();
    const wsRepo = makeWsRepo({
      mutualConnections: [],
      feedSubs: { 'course:c1': [{ connectionId: 'conn-1' }] },
    });

    await broadcastToFeedSubscribers(
      managementApi as never,
      wsRepo as never,
      'course',
      'c1',
      'course',
      message,
    );

    expect(managementApi.send).toHaveBeenCalledTimes(1);
  });

  it('still delivers to entities reached through a mutual', async () => {
    const managementApi = makeManagementApi();
    const wsRepo = makeWsRepo({
      mutualConnections: [{ entityType: 'student', entityId: 's1' }],
      feedSubs: { 'student:s1': [{ connectionId: 'conn-2' }] },
    });

    await broadcastToFeedSubscribers(
      managementApi as never,
      wsRepo as never,
      'course',
      'c1',
      'course',
      message,
    );

    expect(managementApi.send).toHaveBeenCalledTimes(1);
  });

  it('sends a connection one message when it is reachable twice over', async () => {
    const managementApi = makeManagementApi();
    const wsRepo = makeWsRepo({
      mutualConnections: [{ entityType: 'student', entityId: 's1' }],
      feedSubs: {
        'course:c1': [{ connectionId: 'conn-dup' }],
        'student:s1': [{ connectionId: 'conn-dup' }],
      },
    });

    await broadcastToFeedSubscribers(
      managementApi as never,
      wsRepo as never,
      'course',
      'c1',
      'course',
      message,
    );

    expect(managementApi.send).toHaveBeenCalledTimes(1);
  });

  it('respects the feedTypes whitelist', async () => {
    const managementApi = makeManagementApi();
    const wsRepo = makeWsRepo({
      mutualConnections: [],
      feedSubs: {
        'course:c1': [{ connectionId: 'conn-3', feedTypes: ['enrollment'] }],
      },
    });

    await broadcastToFeedSubscribers(
      managementApi as never,
      wsRepo as never,
      'course',
      'c1',
      'badge',
      message,
    );

    expect(managementApi.send).not.toHaveBeenCalled();
  });
});
