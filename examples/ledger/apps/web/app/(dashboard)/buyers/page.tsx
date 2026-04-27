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
import BuyerSummary from '#/components/buyer-summary';
import RevenueChart from '#/components/revenue-chart';

type Granularity = 'daily' | 'monthly';

export default function BuyersPage() {
  const defaults = getDefaultDateRange();
  const [selectedBuyer, setSelectedBuyer] = useState<string>('');
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [tab, setTab] = useState('list');
  const [granularity, setGranularity] = useState<Granularity>('monthly');

  const { entities: buyers, isLoading: buyersLoading } =
    useEntities(Entity.BUYER, { all: true });
  useEntities(Entity.MERCHANT);

  const endDisabled = tab === 'chart' && granularity === 'daily';
  const effectiveEnd = endDisabled ? start : end;

  const { entities: transactions, isLoading: txnLoading } =
    useTaggedEntities(Entity.TRANSACTION, 'buyer-date', {
      params: {
        ...(selectedBuyer ? { group: selectedBuyer } : {}),
        start: monthToStartDate(start),
        end: monthToEndDate(effectiveEnd),
      },
    });

  const getBuyerName = (id: string) =>
    buyers?.find((b) => b.entityId === id)?.data?.name ?? id;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Buyers</h1>
        <p className="text-sm text-muted-foreground">
          View transactions by buyer
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Buyer</label>
              <Select value={selectedBuyer} onValueChange={setSelectedBuyer}>
                <SelectTrigger className="w-60">
                  <SelectValue
                    placeholder={
                      buyersLoading ? 'Loading...' : 'Select buyer'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {buyers?.map((b) => (
                    <SelectItem key={b.entityId} value={b.entityId}>
                      {b.data.name}
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

      {selectedBuyer ? (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold">
            {getBuyerName(selectedBuyer)}
            {transactions && ` — ${transactions.length} transactions`}
          </h2>

          <BuyerSummary transactions={transactions ?? []} />

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
                    showBuyer={false}
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
                    positiveLabel="Spent (purchases)"
                    negativeLabel="Received (refunds + discounts)"
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
          Select a buyer to view their transactions.
        </p>
      )}
    </div>
  );
}
