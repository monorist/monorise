import { MonoriseCore, MonoriseCoreArgs, FunctionConfig } from './components/monorise-core';
import { QFunction, QFunctionArgs } from './components/q-function';
import { SingleTable, SingleTableArgs, BillingMode, CapacityConfig } from './components/single-table';

export const monorise = {
  module: {
    Core: MonoriseCore,
  },
  block: {
    QFunction,
    SingleTable,
  },
};

// Export types for users
export type {
  MonoriseCoreArgs,
  FunctionConfig,
  QFunctionArgs,
  SingleTableArgs,
  BillingMode,
  CapacityConfig,
};

// Export classes directly for advanced use cases
export { MonoriseCore, QFunction, SingleTable };
