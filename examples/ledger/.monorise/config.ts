
import type { z } from 'zod';
import buyer from '../monorise/configs/buyer';
import merchant from '../monorise/configs/merchant';
import monthlySummary from '../monorise/configs/monthly-summary';
import transaction from '../monorise/configs/transaction';
import wallet from '../monorise/configs/wallet';

export enum Entity {
  BUYER = 'buyer',
  MERCHANT = 'merchant',
  MONTHLY_SUMMARY = 'monthly-summary',
  TRANSACTION = 'transaction',
  WALLET = 'wallet'
}

export type BuyerType = z.infer<(typeof buyer)['finalSchema']>;
export type MerchantType = z.infer<(typeof merchant)['finalSchema']>;
export type MonthlySummaryType = z.infer<(typeof monthlySummary)['finalSchema']>;
export type TransactionType = z.infer<(typeof transaction)['finalSchema']>;
export type WalletType = z.infer<(typeof wallet)['finalSchema']>;

export interface EntitySchemaMap {
  [Entity.BUYER]: BuyerType;
  [Entity.MERCHANT]: MerchantType;
  [Entity.MONTHLY_SUMMARY]: MonthlySummaryType;
  [Entity.TRANSACTION]: TransactionType;
  [Entity.WALLET]: WalletType;
}

const EntityConfig = {
  [Entity.BUYER]: buyer,
  [Entity.MERCHANT]: merchant,
  [Entity.MONTHLY_SUMMARY]: monthlySummary,
  [Entity.TRANSACTION]: transaction,
  [Entity.WALLET]: wallet,
};

const FormSchema = {
  [Entity.BUYER]: buyer.finalSchema,
  [Entity.MERCHANT]: merchant.finalSchema,
  [Entity.MONTHLY_SUMMARY]: monthlySummary.finalSchema,
  [Entity.TRANSACTION]: transaction.finalSchema,
  [Entity.WALLET]: wallet.finalSchema,
};

const AllowedEntityTypes = [
  Entity.BUYER,
  Entity.MERCHANT,
  Entity.MONTHLY_SUMMARY,
  Entity.TRANSACTION,
  Entity.WALLET
];

const EmailAuthEnabledEntities: Entity[] = [];

export {
  EntityConfig,
  FormSchema,
  AllowedEntityTypes,
  EmailAuthEnabledEntities,
};

const config = {
  EntityConfig,
  FormSchema,
  AllowedEntityTypes,
  EmailAuthEnabledEntities,
};

export default config;

declare module 'monorise/base' {
  export enum Entity {
    BUYER = 'buyer',
    MERCHANT = 'merchant',
    MONTHLY_SUMMARY = 'monthly-summary',
    TRANSACTION = 'transaction',
    WALLET = 'wallet'
  }

  export type BuyerType = z.infer<(typeof buyer)['finalSchema']>;
  export type MerchantType = z.infer<(typeof merchant)['finalSchema']>;
  export type MonthlySummaryType = z.infer<(typeof monthlySummary)['finalSchema']>;
  export type TransactionType = z.infer<(typeof transaction)['finalSchema']>;
  export type WalletType = z.infer<(typeof wallet)['finalSchema']>;

  export interface EntitySchemaMap {
    [Entity.BUYER]: BuyerType;
    [Entity.MERCHANT]: MerchantType;
    [Entity.MONTHLY_SUMMARY]: MonthlySummaryType;
    [Entity.TRANSACTION]: TransactionType;
    [Entity.WALLET]: WalletType;
  }
}
