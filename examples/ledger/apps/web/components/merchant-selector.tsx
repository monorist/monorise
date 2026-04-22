'use client';

import { useState, useRef } from 'react';
import type { CreatedEntity } from 'monorise/base';
import { Entity } from '#/monorise/entities';

type Merchant = CreatedEntity<Entity.MERCHANT>;

export default function MerchantSelector({
  merchants,
  selectedIds,
  onSelectionChange,
}: {
  merchants: Merchant[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = merchants.filter(
    (m) =>
      !selectedIds.includes(m.entityId) &&
      m.data.name.toLowerCase().includes(query.toLowerCase()),
  );

  const selected = merchants.filter((m) => selectedIds.includes(m.entityId));

  const add = (id: string) => {
    onSelectionChange([...selectedIds, id]);
    setQuery('');
  };

  const remove = (id: string) => {
    onSelectionChange(selectedIds.filter((s) => s !== id));
  };

  return (
    <div className="relative">
      <div
        className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5"
        onClick={() => {
          inputRef.current?.focus();
          setOpen(true);
        }}
      >
        {selected.map((m) => (
          <span
            key={m.entityId}
            className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
          >
            {m.data.name}
            <button
              onClick={(e) => {
                e.stopPropagation();
                remove(m.entityId);
              }}
              className="ml-0.5 text-primary/60 hover:text-primary"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder={selected.length === 0 ? 'Search merchants...' : ''}
          className="min-w-20 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {open && filtered.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-white shadow-lg">
          {filtered.map((m) => (
            <button
              key={m.entityId}
              onMouseDown={(e) => {
                e.preventDefault();
                add(m.entityId);
              }}
              className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-muted"
            >
              {m.data.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
