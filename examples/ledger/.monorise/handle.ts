
import CoreFactory from 'monorise/core';
import config from './config';
import routes from '../services/core/routes';
const coreFactory = new CoreFactory(config);

export const replicationHandler = coreFactory.replicationProcessor;
export const mutualHandler = coreFactory.mutualProcessor;
export const tagHandler = coreFactory.tagProcessor;
export const treeHandler = coreFactory.prejoinProcessor;
export const appHandler = coreFactory.appHandler({ routes });
