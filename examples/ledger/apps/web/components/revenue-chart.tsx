'use client';

import { useMemo } from 'react';

type Transaction = {
  entityId: string;
  data: {
    amount: number;
    type: 'sale' | 'refund' | 'discount';
    transactionDate: string;
    [key: string]: any;
  };
};

type Granularity = 'daily' | 'monthly';

function formatCurrency(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatCompact(cents: number) {
  const abs = Math.abs(cents / 100);
  if (abs >= 1000) return `$${(cents / 100000).toFixed(1)}k`;
  return `$${(cents / 100).toFixed(0)}`;
}

function groupTransactions(
  transactions: Transaction[],
  granularity: Granularity,
) {
  const buckets = new Map<string, number>();

  for (const txn of transactions) {
    const date = txn.data.transactionDate?.split('T')[0];
    if (!date) continue;

    const key = granularity === 'daily' ? date : date.slice(0, 7);
    const amount = txn.data.amount ?? 0;
    const value = txn.data.type === 'sale' ? amount : -amount;

    buckets.set(key, (buckets.get(key) ?? 0) + value);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label, value }));
}

function formatLabel(label: string, granularity: Granularity) {
  if (granularity === 'monthly') {
    const [year, month] = label.split('-');
    const monthNames = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return `${monthNames[parseInt(month) - 1]} ${year}`;
  }
  const parts = label.split('-');
  return `${parts[1]}/${parts[2]}`;
}

export default function RevenueChart({
  transactions,
  granularity,
  positiveLabel = 'Income (sales)',
  negativeLabel = 'Outgoing (refunds + discounts)',
}: {
  transactions: Transaction[];
  granularity: Granularity;
  positiveLabel?: string;
  negativeLabel?: string;
}) {
  const data = useMemo(
    () => groupTransactions(transactions, granularity),
    [transactions, granularity],
  );

  if (!data.length) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No data to display.
      </p>
    );
  }

  const maxAbs = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  const barAreaHeight = 360;

  const tickCount = 5;
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => {
    return Math.round((maxAbs / tickCount) * (tickCount - i));
  });

  const showLabel = (i: number) => {
    if (granularity === 'monthly') return true;
    return i % 5 === 0;
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-white p-5">
        {/* Chart grid */}
        <div className="flex">
          {/* Y-axis labels */}
          <div
            className="flex shrink-0 flex-col justify-between pr-3 text-right text-xs text-muted-foreground"
            style={{ height: barAreaHeight }}
          >
            {yTicks.map((tick, i) => (
              <span key={i} className="whitespace-nowrap leading-none">
                {formatCompact(tick)}
              </span>
            ))}
          </div>

          {/* Bars area */}
          <div className="relative flex-1">
            {/* Grid lines */}
            <div
              className="pointer-events-none absolute inset-0 flex flex-col justify-between"
              style={{ height: barAreaHeight }}
            >
              {yTicks.map((_, i) => (
                <div key={i} className="border-b border-gray-100" />
              ))}
            </div>

            {/* Bars */}
            <div
              className="relative flex items-end justify-around gap-1"
              style={{ height: barAreaHeight }}
            >
              {data.map((d, i) => {
                const isPositive = d.value >= 0;
                const height =
                  (Math.abs(d.value) / maxAbs) * barAreaHeight;

                return (
                  <div
                    key={d.label}
                    className="group flex flex-col items-center"
                    style={{ height: barAreaHeight }}
                  >
                    {/* Tooltip */}
                    <div className="pointer-events-none absolute -top-12 z-10 hidden rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg whitespace-nowrap group-hover:block">
                      {formatLabel(d.label, granularity)}
                      <br />
                      {formatCurrency(d.value)}
                    </div>

                    {/* Spacer to push bar to bottom */}
                    <div className="flex-1" />

                    {/* Bar */}
                    <div
                      className={`w-4 rounded-t-sm transition-colors ${
                        isPositive
                          ? 'bg-emerald-500 hover:bg-emerald-600'
                          : 'bg-rose-400 hover:bg-rose-500'
                      }`}
                      style={{ height: Math.max(height, 3) }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* X-axis labels */}
        <div className="mt-3 flex" style={{ marginLeft: 56 }}>
          <div className="flex flex-1 justify-around gap-1">
            {data.map((d, i) => (
              <div key={d.label} className="flex w-4 justify-center">
                {showLabel(i) && (
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {formatLabel(d.label, granularity)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
          {positiveLabel}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-sm bg-rose-400" />
          {negativeLabel}
        </div>
      </div>
    </div>
  );
}
