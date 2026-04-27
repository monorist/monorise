'use client';

import { useState } from 'react';
import { useEntities, useTaggedEntities } from 'monorise/react';
import { Entity } from '#/monorise/config';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card';
import { Button } from '#/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '#/components/ui/tabs';
import DateRangeFilter, {
  getDefaultDateRange,
  monthToStartDate,
  monthToEndDate,
  formatMonthLabel,
} from '#/components/date-range-filter';
import TransactionTable from '#/components/transaction-table';
import TransactionSummary from '#/components/transaction-summary';
import RevenueChart from '#/components/revenue-chart';

type Granularity = 'daily' | 'monthly';

export default function MerchantsPage() {
  const defaults = getDefaultDateRange();
  const [selectedMerchant, setSelectedMerchant] = useState<string>('');
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [tab, setTab] = useState('list');
  const [granularity, setGranularity] = useState<Granularity>('monthly');

  const { entities: merchants, isLoading: merchantsLoading } =
    useEntities(Entity.MERCHANT);
  useEntities(Entity.BUYER, { all: true });

  const endDisabled = tab === 'chart' && granularity === 'daily';
  const effectiveEnd = endDisabled ? start : end;

  const { entities: transactions, isLoading: txnLoading } =
    useTaggedEntities(Entity.TRANSACTION, 'merchant-date', {
      params: {
        ...(selectedMerchant ? { group: selectedMerchant } : {}),
        start: monthToStartDate(start),
        end: monthToEndDate(effectiveEnd),
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
              endDisabled={endDisabled}
            />
          </div>
        </CardContent>
      </Card>

      {selectedMerchant ? (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold">
            {getMerchantName(selectedMerchant)}
            {transactions && ` — ${transactions.length} transactions`}
          </h2>

          <TransactionSummary transactions={transactions ?? []} />

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="list">List</TabsTrigger>
              <TabsTrigger value="chart">Chart</TabsTrigger>
            </TabsList>

            <TabsContent value="list">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Transactions from {formatMonthLabel(start)} to{' '}
                    {formatMonthLabel(end)}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <TransactionTable
                    transactions={transactions ?? []}
                    isLoading={txnLoading}
                    showMerchant={false}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="chart">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      {granularity === 'daily'
                        ? `Daily transactions at ${formatMonthLabel(start)}`
                        : `Monthly transactions from ${formatMonthLabel(start)} to ${formatMonthLabel(end)}`}
                    </CardTitle>
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
                        variant={
                          granularity === 'monthly' ? 'default' : 'ghost'
                        }
                        size="sm"
                        onClick={() => setGranularity('monthly')}
                        className="rounded-l-none"
                      >
                        Monthly
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <RevenueChart
                    transactions={transactions ?? []}
                    granularity={granularity}
                    startMonth={start}
                    endMonth={effectiveEnd}
                  />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Select a merchant to view their transactions.
        </p>
      )}
    </div>
  );
}
