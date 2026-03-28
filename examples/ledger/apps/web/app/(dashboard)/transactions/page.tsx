'use client';

import { useState } from 'react';
import { useTaggedEntities, axios } from 'monorise/react';
import { Entity } from '#/monorise/entities';
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card';
import { Button } from '#/components/ui/button';
import DateRangeFilter, {
  getDefaultDateRange,
} from '#/components/date-range-filter';
import TransactionTable from '#/components/transaction-table';

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

export default function TransactionsPage() {
  const defaults = getDefaultDateRange();
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [summary, setSummary] = useState<Summary | null>(null);

  const {
    entities: transactions,
    isLoading: txnLoading,
    refetch,
  } = useTaggedEntities(Entity.TRANSACTION, 'date', {
    params: { start, end },
  });

  const fetchSummary = async () => {
    const { data } = await axios.get(
      `/core/app/summary?start=${start}&end=${end}`,
      { requestKey: 'summary' },
    );
    setSummary(data);
  };

  const handleRefresh = () => {
    refetch();
    fetchSummary();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Transactions</h1>
        <p className="text-sm text-muted-foreground">
          All transactions with date range filtering and summary
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <DateRangeFilter
              start={start}
              end={end}
              onStartChange={setStart}
              onEndChange={setEnd}
            />
            <Button onClick={handleRefresh} disabled={txnLoading}>
              {txnLoading ? 'Loading...' : 'Fetch'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {summary && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <SummaryCard
            label="Total Sales"
            value={formatCurrency(summary.totalSales)}
            className="border-green-200 bg-green-50 text-green-700"
          />
          <SummaryCard
            label="Total Refunds"
            value={formatCurrency(summary.totalRefunds)}
            className="border-red-200 bg-red-50 text-red-700"
          />
          <SummaryCard
            label="Total Discounts"
            value={formatCurrency(summary.totalDiscounts)}
            className="border-orange-200 bg-orange-50 text-orange-700"
          />
          <SummaryCard
            label="Net Total"
            value={formatCurrency(summary.netTotal)}
            className="border-indigo-200 bg-indigo-50 text-indigo-700"
          />
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">
          Transactions
          {transactions && ` (${transactions.length})`}
        </h2>
        <TransactionTable
          transactions={transactions ?? []}
          isLoading={txnLoading}
        />
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
