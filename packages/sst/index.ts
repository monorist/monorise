import { MonoriseCore } from './components/monorise-core';
import { QFunction } from './components/q-function';

export const monorise = {
  module: {
    Core: MonoriseCore,
  },
  block: {
    QFunction,
  },
};

export {
  connect as wsConnect,
  disconnect as wsDisconnect,
  // biome-ignore lint: default is a reserved word but valid export name
  default as wsDefault,
  broadcast as wsBroadcast,
} from './handlers/websocket';

