'use client';

import { useMemo } from 'react';
import type { CreatedEntity } from 'monorise/base';
import { Entity } from '#/monorise/config';

type Transaction = CreatedEntity<Entity.TRANSACTION>;

function formatCurrency(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function BuyerSummary({
  transactions,
}: {
  transactions: Transaction[];
}) {
  const summary = useMemo(() => {
    let totalSpent = 0;
    let totalRefunds = 0;
    let totalDiscounts = 0;

    for (const txn of transactions) {
      const amount = txn.data.amount ?? 0;
      switch (txn.data.type) {
        case 'sale':
          totalSpent += amount;
          break;
        case 'refund':
          totalRefunds += amount;
          break;
        case 'discount':
          totalDiscounts += amount;
          break;
      }
    }

    return {
      totalSpent,
      totalRefunds,
      totalDiscounts,
      netSpent: totalSpent - totalRefunds - totalDiscounts,
      count: transactions.length,
    };
  }, [transactions]);

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
      <SummaryCard label="Transactions" value={String(summary.count)} />
      <SummaryCard
        label="Total Spent"
        value={formatCurrency(summary.totalSpent)}
        className="bg-blue-50 text-blue-700 border-blue-200"
      />
      <SummaryCard
        label="Total Refunds"
        value={formatCurrency(summary.totalRefunds)}
        className="bg-red-50 text-red-700 border-red-200"
      />
      <SummaryCard
        label="Total Discounts"
        value={formatCurrency(summary.totalDiscounts)}
        className="bg-orange-50 text-orange-700 border-orange-200"
      />
      <SummaryCard
        label="Net Spent"
        value={formatCurrency(summary.netSpent)}
        className="bg-indigo-50 text-indigo-700 border-indigo-200"
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border p-4 ${className ?? ''}`}>
      <div className="text-sm font-medium opacity-80">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}
