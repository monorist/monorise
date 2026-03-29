'use client';

import { Label } from '#/components/ui/label';

export function getDefaultDateRange() {
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  return {
    start: `${sixMonthsAgo.getFullYear()}-${String(sixMonthsAgo.getMonth() + 1).padStart(2, '0')}`,
    end: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  };
}

// Convert YYYY-MM to first day of month for API
export function monthToStartDate(month: string) {
  return `${month}-01`;
}

// Convert YYYY-MM to last day of month for API
export function monthToEndDate(month: string) {
  const [year, m] = month.split('-').map(Number);
  const lastDay = new Date(year, m, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, '0')}`;
}

export function formatMonthLabel(month: string) {
  const [year, m] = month.split('-');
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${monthNames[parseInt(m) - 1]} ${year}`;
}

export default function DateRangeFilter({
  start,
  end,
  onStartChange,
  onEndChange,
  endDisabled = false,
}: {
  start: string; // YYYY-MM
  end: string; // YYYY-MM
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
  endDisabled?: boolean;
}) {
  return (
    <div className="flex items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="start">Start month</Label>
        <input
          id="start"
          type="month"
          value={start}
          onChange={(e) => onStartChange(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="end">End month</Label>
        <input
          id="end"
          type="month"
          value={end}
          onChange={(e) => onEndChange(e.target.value)}
          disabled={endDisabled}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
    </div>
  );
}
