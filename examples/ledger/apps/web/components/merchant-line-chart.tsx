'use client';

import { useMemo, useState } from 'react';

type Summary = {
  entityId: string;
  data: {
    merchantId: string;
    month: string;
    totalSales: number;
    totalRefunds: number;
    totalDiscounts: number;
    netTotal: number;
    count: number;
  };
};

type Merchant = {
  entityId: string;
  data: { name: string; [key: string]: any };
};

function formatCompact(cents: number) {
  const val = cents / 100;
  if (Math.abs(val) >= 1000) return `$${(val / 1000).toFixed(1)}k`;
  return `$${val.toFixed(0)}`;
}

function formatCurrency(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
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

function formatMonth(month: string) {
  const [year, m] = month.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[parseInt(m) - 1]} ${year}`;
}

const COLORS = [
  '#6366f1', '#ec4899', '#f97316', '#14b8a6', '#8b5cf6',
  '#ef4444', '#22c55e', '#eab308', '#06b6d4', '#f43f5e',
];

export default function MerchantLineChart({
  summaries,
  merchants,
  selectedMerchantIds,
  startMonth,
  endMonth,
}: {
  summaries: Summary[];
  merchants: Merchant[];
  selectedMerchantIds: string[];
  startMonth: string;
  endMonth: string;
}) {
  const [hoveredMonth, setHoveredMonth] = useState<number | null>(null);

  const months = useMemo(() => generateMonths(startMonth, endMonth), [startMonth, endMonth]);

  const series = useMemo(() => {
    return selectedMerchantIds.map((merchantId, idx) => {
      const merchantSummaries = summaries.filter(
        (s) => s.data.merchantId === merchantId,
      );
      const summaryByMonth = new Map(
        merchantSummaries.map((s) => [s.data.month, s.data.netTotal]),
      );
      const values = months.map((m) => summaryByMonth.get(m) ?? 0);
      const merchant = merchants.find((m) => m.entityId === merchantId);
      return {
        merchantId,
        name: merchant?.data?.name ?? merchantId.slice(0, 8) + '...',
        values,
        color: COLORS[idx % COLORS.length],
      };
    });
  }, [summaries, selectedMerchantIds, months, merchants]);

  if (!series.length || !months.length) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No data to display.
      </p>
    );
  }

  const allValues = series.flatMap((s) => s.values);
  const maxVal = Math.max(...allValues, 1);
  const minVal = Math.min(...allValues, 0);
  const range = maxVal - minVal || 1;

  const chartWidth = 800;
  const chartHeight = 350;
  const padding = { top: 20, right: 20, bottom: 40, left: 70 };
  const plotW = chartWidth - padding.left - padding.right;
  const plotH = chartHeight - padding.top - padding.bottom;

  const xStep = months.length > 1 ? plotW / (months.length - 1) : plotW;
  const toX = (i: number) => padding.left + i * xStep;
  const toY = (v: number) => padding.top + plotH - ((v - minVal) / range) * plotH;

  const tickCount = 5;
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => {
    return minVal + (range / tickCount) * i;
  });

  // Tooltip x position as percentage
  const tooltipX = hoveredMonth !== null ? (toX(hoveredMonth) / chartWidth) * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="relative overflow-visible rounded-lg border bg-white">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full"
          onMouseLeave={() => setHoveredMonth(null)}
        >
          {/* Grid lines */}
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={padding.left}
                y1={toY(tick)}
                x2={chartWidth - padding.right}
                y2={toY(tick)}
                stroke="#f0f0f0"
                strokeWidth={1}
              />
              <text
                x={padding.left - 8}
                y={toY(tick) + 4}
                textAnchor="end"
                className="fill-gray-400"
                fontSize={11}
              >
                {formatCompact(Math.round(tick))}
              </text>
            </g>
          ))}

          {/* X-axis labels */}
          {months.map((month, i) => (
            <text
              key={month}
              x={toX(i)}
              y={chartHeight - 10}
              textAnchor="middle"
              className="fill-gray-400"
              fontSize={11}
            >
              {formatMonth(month).split(' ')[0]}
            </text>
          ))}

          {/* Hover vertical line */}
          {hoveredMonth !== null && (
            <line
              x1={toX(hoveredMonth)}
              y1={padding.top}
              x2={toX(hoveredMonth)}
              y2={padding.top + plotH}
              stroke="#d1d5db"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          )}

          {/* Lines */}
          {series.map((s) => {
            const points = s.values
              .map((v, i) => `${toX(i)},${toY(v)}`)
              .join(' ');
            return (
              <polyline
                key={s.merchantId}
                points={points}
                fill="none"
                stroke={s.color}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}

          {/* Dots — highlighted on hovered month */}
          {series.map((s) =>
            s.values.map((v, mIdx) => (
              <circle
                key={`${s.merchantId}-${mIdx}`}
                cx={toX(mIdx)}
                cy={toY(v)}
                r={hoveredMonth === mIdx ? 6 : 4}
                fill={s.color}
                stroke="white"
                strokeWidth={2}
                className="transition-all"
              />
            )),
          )}

          {/* Invisible hover columns — full height per month */}
          {months.map((_, i) => {
            const colWidth = months.length > 1 ? xStep : plotW;
            const x = toX(i) - colWidth / 2;
            return (
              <rect
                key={i}
                x={Math.max(x, padding.left)}
                y={padding.top}
                width={Math.min(colWidth, plotW)}
                height={plotH}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoveredMonth(i)}
              />
            );
          })}
        </svg>

        {/* Tooltip — shows all merchants for the hovered month */}
        {hoveredMonth !== null && (
          <div
            className={`pointer-events-none absolute z-10 rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white shadow-lg whitespace-nowrap ${
              tooltipX > 70 ? '-translate-x-full' : tooltipX < 30 ? '' : '-translate-x-1/2'
            }`}
            style={{
              left: `${tooltipX}%`,
              top: 8,
            }}
          >
            <div className="mb-1.5 text-gray-300">
              {formatMonth(months[hoveredMonth])}
            </div>
            {series.map((s) => (
              <div key={s.merchantId} className="flex items-center justify-between gap-4 py-0.5">
                <div className="flex items-center gap-1.5">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <span>{s.name}</span>
                </div>
                <span className="font-mono">{formatCurrency(s.values[hoveredMonth])}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {series.map((s) => (
          <div key={s.merchantId} className="flex items-center gap-1.5">
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            {s.name}
          </div>
        ))}
      </div>
    </div>
  );
}
