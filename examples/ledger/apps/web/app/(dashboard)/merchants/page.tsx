'use client';

import { useState } from 'react';
import { useEntities, useTaggedEntities } from 'monorise/react';
import { Entity } from '#/monorise/entities';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card';
import { Button } from '#/components/ui/button';
import DateRangeFilter, {
  getDefaultDateRange,
} from '#/components/date-range-filter';
import TransactionTable from '#/components/transaction-table';
import TransactionSummary from '#/components/transaction-summary';
import RevenueChart from '#/components/revenue-chart';

type ViewMode = 'list' | 'chart';
type Granularity = 'daily' | 'monthly';

export default function MerchantsPage() {
  const defaults = getDefaultDateRange();
  const [selectedMerchant, setSelectedMerchant] = useState<string>('');
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [granularity, setGranularity] = useState<Granularity>('monthly');

  const { entities: merchants, isLoading: merchantsLoading } =
    useEntities(Entity.MERCHANT);
  useEntities(Entity.BUYER, { all: true });

  const { entities: transactions, isLoading: txnLoading } =
    useTaggedEntities(Entity.TRANSACTION, 'merchant-date', {
      params: {
        ...(selectedMerchant ? { group: selectedMerchant } : {}),
        start,
        end,
      },
    });

  const getMerchantName = (id: string) =>
    merchants?.find((m) => m.entityId === id)?.data?.name ?? id;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Merchants</h1>
        <p className="text-sm text-muted-foreground">
          View transactions by merchant
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Merchant</label>
              <Select
                value={selectedMerchant}
                onValueChange={setSelectedMerchant}
              >
                <SelectTrigger className="w-60">
                  <SelectValue
                    placeholder={
                      merchantsLoading ? 'Loading...' : 'Select merchant'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {merchants?.map((m) => (
                    <SelectItem key={m.entityId} value={m.entityId}>
                      {m.data.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DateRangeFilter
              start={start}
              end={end}
              onStartChange={setStart}
              onEndChange={setEnd}
            />
          </div>
        </CardContent>
      </Card>

      {selectedMerchant ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {getMerchantName(selectedMerchant)}
              {transactions && ` — ${transactions.length} transactions`}
            </h2>
            <div className="flex items-center gap-2">
              {viewMode === 'chart' && (
                <div className="flex rounded-md border">
                  <Button
                    variant={granularity === 'daily' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setGranularity('daily')}
                    className="rounded-r-none"
                  >
                    Daily
                  </Button>
                  <Button
                    variant={granularity === 'monthly' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setGranularity('monthly')}
                    className="rounded-l-none"
                  >
                    Monthly
                  </Button>
                </div>
              )}
              <div className="flex rounded-md border">
                <Button
                  variant={viewMode === 'list' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                  className="rounded-r-none"
                >
                  List
                </Button>
                <Button
                  variant={viewMode === 'chart' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('chart')}
                  className="rounded-l-none"
                >
                  Chart
                </Button>
              </div>
            </div>
          </div>

          <TransactionSummary transactions={transactions ?? []} />

          {viewMode === 'list' ? (
            <TransactionTable
              transactions={transactions ?? []}
              isLoading={txnLoading}
              showMerchant={false}
            />
          ) : (
            <RevenueChart
              transactions={transactions ?? []}
              granularity={granularity}
            />
          )}
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Select a merchant to view their transactions.
        </p>
      )}
    </div>
  );
}
