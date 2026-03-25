'use client';

import { useState } from 'react';
import {
  useTaggedEntities,
  useEntities,
  createEntity,
  axios,
} from 'monorise/react';
import { Entity } from '#/monorise/entities';

type Summary = {
  count: number;
  totalSales: number;
  totalRefunds: number;
  totalDiscounts: number;
  netTotal: number;
};

function formatCurrency(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function getDefaultDateRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

export default function DashboardPage() {
  const defaults = getDefaultDateRange();
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Fetch transactions by date range using monorise hook
  const {
    entities: transactions,
    isLoading: txnLoading,
    refetch: refetchTransactions,
  } = useTaggedEntities(Entity.TRANSACTION, 'date', {
    params: { start, end },
  });

  // Fetch all merchants for display
  const { entities: merchants } = useEntities(Entity.MERCHANT);
  const { entities: buyers } = useEntities(Entity.BUYER);

  const fetchSummary = async () => {
    setSummaryLoading(true);
    try {
      const { data } = await axios.get(
        `/core/app/summary?start=${start}&end=${end}`,
        { requestKey: 'summary' },
      );
      setSummary(data);
    } finally {
      setSummaryLoading(false);
    }
  };

  const getMerchantName = (id: string) =>
    merchants?.find((m) => m.entityId === id)?.data?.name ?? id;

  const getBuyerName = (id: string) =>
    buyers?.find((b) => b.entityId === id)?.data?.name ?? id;

  const handleRefresh = () => {
    refetchTransactions();
    fetchSummary();
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-bold">Ledger Dashboard</h1>
      <p className="mt-1 text-gray-500">
        Monorise example — transaction management on DynamoDB
      </p>

      {/* Date range selector */}
      <div className="mt-8 flex items-end gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Start
          </label>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            End
          </label>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={handleRefresh}
          disabled={txnLoading || summaryLoading}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {txnLoading || summaryLoading ? 'Loading...' : 'Fetch'}
        </button>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <SummaryCard
            label="Total Sales"
            value={formatCurrency(summary.totalSales)}
            className="bg-green-50 text-green-700"
          />
          <SummaryCard
            label="Total Refunds"
            value={formatCurrency(summary.totalRefunds)}
            className="bg-red-50 text-red-700"
          />
          <SummaryCard
            label="Total Discounts"
            value={formatCurrency(summary.totalDiscounts)}
            className="bg-orange-50 text-orange-700"
          />
          <SummaryCard
            label="Net Total"
            value={formatCurrency(summary.netTotal)}
            className="bg-indigo-50 text-indigo-700"
          />
        </div>
      )}

      {/* Quick create */}
      <QuickCreate />

      {/* Transactions table */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold">
          Transactions
          {transactions && ` (${transactions.length})`}
        </h2>
        {txnLoading ? (
          <p className="mt-4 text-sm text-gray-500">Loading transactions...</p>
        ) : transactions && transactions.length > 0 ? (
          <div className="mt-3 overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-100 text-gray-600">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Merchant</th>
                  <th className="px-4 py-3">Buyer</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transactions.map((txn) => (
                  <tr key={txn.entityId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {txn.data.transactionDate?.split('T')[0]}
                    </td>
                    <td className="px-4 py-3">
                      <TypeBadge type={txn.data.type} />
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {formatCurrency(txn.data.amount)}
                    </td>
                    <td className="px-4 py-3">
                      {getMerchantName(txn.data.merchantId)}
                    </td>
                    <td className="px-4 py-3">
                      {getBuyerName(txn.data.buyerId)}
                    </td>
                    <td className="px-4 py-3 capitalize">{txn.data.status}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {txn.data.description || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-500">
            No transactions found for this date range.
          </p>
        )}
      </div>
    </div>
  );
}

function QuickCreate() {
  const [open, setOpen] = useState(false);

  const handleCreateSample = async () => {
    const now = new Date().toISOString();

    // Create a merchant
    const { data: merchant } = await createEntity(Entity.MERCHANT, {
      name: 'Coffee House',
      category: 'food-beverage',
      contactEmail: 'hello@coffeehouse.com',
    });

    // Create a buyer
    const { data: buyer } = await createEntity(Entity.BUYER, {
      name: 'Alice',
      email: `alice+${Date.now()}@example.com`,
    });

    if (!merchant || !buyer) return;

    // Create sample transactions
    const transactions = [
      {
        amount: 5000,
        type: 'sale' as const,
        description: 'Latte and croissant',
        transactionDate: now,
        status: 'completed' as const,
      },
      {
        amount: 15000,
        type: 'sale' as const,
        description: 'Premium coffee bundle',
        transactionDate: now,
        status: 'completed' as const,
      },
      {
        amount: 2000,
        type: 'refund' as const,
        description: 'Wrong order refund',
        transactionDate: now,
        status: 'completed' as const,
      },
      {
        amount: 1500,
        type: 'discount' as const,
        description: 'Loyalty discount',
        transactionDate: now,
        status: 'completed' as const,
      },
    ];

    for (const txn of transactions) {
      await createEntity(Entity.TRANSACTION, {
        ...txn,
        merchantId: merchant.entityId,
        buyerId: buyer.entityId,
        merchantIds: [merchant.entityId],
        buyerIds: [buyer.entityId],
      });
    }

    setOpen(false);
  };

  if (!open) {
    return (
      <div className="mt-6">
        <button
          onClick={() => setOpen(true)}
          className="text-sm text-indigo-600 underline hover:text-indigo-800"
        >
          Seed sample data
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
      <p className="text-sm text-indigo-800">
        This will create a merchant, buyer, and 4 sample transactions (2 sales,
        1 refund, 1 discount).
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={handleCreateSample}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Create sample data
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
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
    <div className={`rounded-lg border p-4 ${className}`}>
      <div className="text-sm font-medium opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    sale: 'bg-green-100 text-green-800',
    refund: 'bg-red-100 text-red-800',
    discount: 'bg-orange-100 text-orange-800',
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[type] || 'bg-gray-100 text-gray-800'}`}
    >
      {type}
    </span>
  );
}
