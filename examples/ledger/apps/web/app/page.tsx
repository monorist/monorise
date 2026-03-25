'use client';

import { useState } from 'react';

const API_BASE = '/api';

type Summary = {
  start: string;
  end: string;
  count: number;
  totalSales: number;
  totalRefunds: number;
  totalDiscounts: number;
  netTotal: number;
};

type Transaction = {
  entityId: string;
  data: {
    amount: number;
    type: 'sale' | 'refund' | 'discount';
    description?: string;
    transactionDate: string;
    status: string;
    merchantId: string;
    buyerId: string;
  };
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
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [summaryRes, txnRes] = await Promise.all([
        fetch(`${API_BASE}/core/app/summary?start=${start}&end=${end}`),
        fetch(
          `${API_BASE}/core/tag/transaction/date?start=${start}&end=${end}`,
        ),
      ]);
      const summaryData = await summaryRes.json();
      const txnData = await txnRes.json();
      setSummary(summaryData);
      setTransactions(txnData.entities || []);
    } finally {
      setLoading(false);
    }
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
          onClick={fetchData}
          disabled={loading}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Fetch'}
        </button>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="mt-8 grid grid-cols-4 gap-4">
          <SummaryCard
            label="Total Sales"
            value={formatCurrency(summary.totalSales)}
            className="text-green-700 bg-green-50"
          />
          <SummaryCard
            label="Total Refunds"
            value={formatCurrency(summary.totalRefunds)}
            className="text-red-700 bg-red-50"
          />
          <SummaryCard
            label="Total Discounts"
            value={formatCurrency(summary.totalDiscounts)}
            className="text-orange-700 bg-orange-50"
          />
          <SummaryCard
            label="Net Total"
            value={formatCurrency(summary.netTotal)}
            className="text-indigo-700 bg-indigo-50"
          />
        </div>
      )}

      {/* Transactions table */}
      {transactions.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold">
            Transactions ({transactions.length})
          </h2>
          <div className="mt-3 overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-100 text-gray-600">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transactions.map((txn) => (
                  <tr key={txn.entityId} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      {txn.data.transactionDate?.split('T')[0]}
                    </td>
                    <td className="px-4 py-3">
                      <TypeBadge type={txn.data.type} />
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {formatCurrency(txn.data.amount)}
                    </td>
                    <td className="px-4 py-3 capitalize">
                      {txn.data.status}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {txn.data.description || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
