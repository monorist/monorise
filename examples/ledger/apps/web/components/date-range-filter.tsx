'use client';

import { Input } from '#/components/ui/input';
import { Label } from '#/components/ui/label';

export function getDefaultDateRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

export default function DateRangeFilter({
  start,
  end,
  onStartChange,
  onEndChange,
}: {
  start: string;
  end: string;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
}) {
  return (
    <div className="flex items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="start">Start date</Label>
        <Input
          id="start"
          type="date"
          value={start}
          onChange={(e) => onStartChange(e.target.value)}
          className="w-40"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="end">End date</Label>
        <Input
          id="end"
          type="date"
          value={end}
          onChange={(e) => onEndChange(e.target.value)}
          className="w-40"
        />
      </div>
    </div>
  );
}
