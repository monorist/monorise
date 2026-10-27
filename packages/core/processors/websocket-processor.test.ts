import { describe, expect, it, vi } from 'vitest';

import { broadcast, broadcastToFeedSubscribers } from './websocket-processor';

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

/**
 * Regression coverage for which stream records `broadcast` treats as
 * broadcastable.
 *
 * This filter has been wrong twice in opposite directions, so it is worth
 * pinning from both sides. Deciding "internal" by testing whether the PK's
 * first segment is all-uppercase silently disables every broadcast for a
 * consumer entity type that happens to be all-caps. Replacing that with a
 * list of known internal prefixes leaks whatever the list forgets -- notably
 * `EMAIL#`, whose SK is `{entityType}#{entityId}` and therefore parses as a
 * mutual pointing at a REAL entity, delivering a user their own email row.
 *
 * Both cases are covered below; the config allowlist is what satisfies them
 * at once.
 */
function makeBroadcastRecord(pk: string, sk: string) {
  return {
    eventName: 'MODIFY',
    dynamodb: { NewImage: { PK: { S: pk }, SK: { S: sk } } },
  };
}

function makeContainer(entityTypes: string[]) {
  const wsRepo = {
    querySubscriptionsByKey: vi.fn().mockResolvedValue([]),
    queryMutualConnections: vi.fn().mockResolvedValue([]),
    queryFeedSubscriptions: vi.fn().mockResolvedValue([]),
    deleteSubscription: vi.fn().mockResolvedValue(undefined),
  };
  const config = {
    EntityConfig: Object.fromEntries(entityTypes.map((t) => [t, {}])),
  };
  return { container: { websocketRepository: wsRepo, config }, wsRepo };
}

describe('broadcast record filtering', () => {
  it('ignores an EMAIL# record, whose SK would otherwise parse as a mutual', async () => {
    const { container, wsRepo } = makeContainer(['student']);

    await broadcast(container as never)({
      Records: [makeBroadcastRecord('EMAIL#alice@example.com', 'student#s1')],
    } as never);

    expect(wsRepo.queryMutualConnections).not.toHaveBeenCalled();
    expect(wsRepo.querySubscriptionsByKey).not.toHaveBeenCalled();
  });

  it('ignores TAG# and UNIQUE# records', async () => {
    const { container, wsRepo } = makeContainer(['student']);

    await broadcast(container as never)({
      Records: [
        makeBroadcastRecord('TAG#student#s1', '#LOCK#'),
        makeBroadcastRecord('UNIQUE#email#alice@example.com', 'student'),
      ],
    } as never);

    expect(wsRepo.queryMutualConnections).not.toHaveBeenCalled();
    expect(wsRepo.querySubscriptionsByKey).not.toHaveBeenCalled();
  });

  it('still broadcasts an all-caps entity type, which the casing heuristic dropped', async () => {
    const { container, wsRepo } = makeContainer(['COURSE']);

    await broadcast(container as never)({
      Records: [makeBroadcastRecord('COURSE#c1', '#METADATA#')],
    } as never);

    expect(wsRepo.querySubscriptionsByKey).toHaveBeenCalled();
  });
});
