import {
  ENTITY_REPLICATION_INDEX,
  MUTUAL_REPLICATION_INDEX,
} from '../constants/table';

const CORE_TABLE = process.env.CORE_TABLE || '';
const CORE_EVENT_BUS = process.env.CORE_EVENT_BUS || '';

export {
  CORE_TABLE,
  CORE_EVENT_BUS,
  ENTITY_REPLICATION_INDEX,
  MUTUAL_REPLICATION_INDEX,
};
