'use client';

import { useMemo } from 'react';
import type { CreatedEntity } from 'monorise/base';
import { Entity } from '#/monorise/config';

type Transaction = CreatedEntity<Entity.TRANSACTION>;

type Granularity = 'daily' | 'monthly';

function formatCurrency(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatCompact(cents: number) {
  const abs = Math.abs(cents / 100);
  if (abs >= 1000) return `$${(cents / 100000).toFixed(1)}k`;
  return `$${(cents / 100).toFixed(0)}`;
}

function generateMonths(start: string, end: string) {
  const months: string[] = [];
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

function generateDays(month: string) {
  const [year, m] = month.split('-').map(Number);
  const daysInMonth = new Date(year, m, 0).getDate();
  const days: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(`${month}-${String(d).padStart(2, '0')}`);
  }
  return days;
}

function groupTransactions(
  transactions: Transaction[],
  granularity: Granularity,
  startMonth: string,
  endMonth: string,
) {
  const buckets = new Map<string, number>();

  if (granularity === 'monthly') {
    for (const m of generateMonths(startMonth, endMonth)) {
      buckets.set(m, 0);
    }
  } else {
    for (const d of generateDays(startMonth)) {
      buckets.set(d, 0);
    }
  }

  for (const txn of transactions) {
    const date = txn.data.transactionDate?.split('T')[0];
    if (!date) continue;
    const key = granularity === 'daily' ? date : date.slice(0, 7);
    if (!buckets.has(key)) continue;
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
  // Daily: show just the day number
  return label.split('-')[2];
}

export default function RevenueChart({
  transactions,
  granularity,
  startMonth,
  endMonth,
  positiveLabel = 'Income (sales)',
  negativeLabel = 'Outgoing (refunds + discounts)',
}: {
  transactions: Transaction[];
  granularity: Granularity;
  startMonth: string;
  endMonth: string;
  positiveLabel?: string;
  negativeLabel?: string;
}) {
  const data = useMemo(
    () => groupTransactions(transactions, granularity, startMonth, endMonth),
    [transactions, granularity, startMonth, endMonth],
  );

  if (!data.length) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No data to display.
      </p>
    );
  }

  const maxAbs = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  const barAreaHeight = 400;

  const tickCount = 5;
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => {
    return Math.round((maxAbs / tickCount) * (tickCount - i));
  });

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-white p-5 pt-10 pb-3">
        <div className="flex">
          {/* Y-axis */}
          <div
            className="flex shrink-0 flex-col justify-between border-r pr-3 text-right text-xs text-muted-foreground"
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
              className="relative flex items-end justify-around"
              style={{ height: barAreaHeight }}
            >
              {data.map((d) => {
                const isPositive = d.value >= 0;
                const height = (Math.abs(d.value) / maxAbs) * barAreaHeight;

                return (
                  <div
                    key={d.label}
                    className="group flex flex-1 flex-col items-center justify-end"
                    style={{ height: barAreaHeight }}
                  >
                    {/* Tooltip */}
                    <div className="pointer-events-none absolute -top-12 z-10 hidden rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg whitespace-nowrap group-hover:block">
                      {granularity === 'daily'
                        ? d.label
                        : formatLabel(d.label, granularity)}
                      <br />
                      {formatCurrency(d.value)}
                    </div>

                    <div className="flex-1" />

                    {/* Bar */}
                    <div
                      className={`w-5 rounded-t-sm transition-colors ${
                        d.value === 0
                          ? 'bg-gray-200'
                          : isPositive
                            ? 'bg-emerald-500 hover:bg-emerald-600'
                            : 'bg-rose-400 hover:bg-rose-500'
                      }`}
                      style={{ height: d.value === 0 ? 2 : Math.max(height, 3) }}
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
            {data.map((d) => (
              <div key={d.label} className="flex w-4 justify-center">
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {granularity === 'monthly'
                    ? formatLabel(d.label, granularity).split(' ')[0]
                    : formatLabel(d.label, granularity)}
                </span>
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
