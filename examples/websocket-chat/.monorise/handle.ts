
import CoreFactory from 'monorise/core';
import config from './config';
const coreFactory = new CoreFactory(config);

export const replicationHandler = coreFactory.replicationProcessor;
export const mutualHandler = coreFactory.mutualProcessor;
export const tagHandler = coreFactory.tagProcessor;
export const treeHandler = coreFactory.prejoinProcessor;
export const appHandler = coreFactory.appHandler({});

// WebSocket handlers (re-exported for SST to resolve)
export { wsConnect, wsDisconnect, wsDefault, wsBroadcast } from 'monorise/core';
