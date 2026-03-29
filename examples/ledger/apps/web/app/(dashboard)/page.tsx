'use client';

import { useState } from 'react';
import { useEntities, useTaggedEntities } from 'monorise/react';
import { Entity } from '#/monorise/entities';
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

export default function HomePage() {
  const defaults = getDefaultDateRange();
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [tab, setTab] = useState('list');
  const [granularity, setGranularity] = useState<Granularity>('monthly');

  useEntities(Entity.MERCHANT);
  useEntities(Entity.BUYER, { all: true });

  const endDisabled = tab === 'chart' && granularity === 'daily';
  const effectiveEnd = endDisabled ? start : end;

  const { entities: transactions, isLoading: txnLoading } =
    useTaggedEntities(Entity.TRANSACTION, 'date', {
      params: {
        start: monthToStartDate(start),
        end: monthToEndDate(effectiveEnd),
      },
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Home</h1>
        <p className="text-sm text-muted-foreground">
          Overview of all transactions
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <DateRangeFilter
            start={start}
            end={end}
            onStartChange={setStart}
            onEndChange={setEnd}
            endDisabled={endDisabled}
          />
        </CardContent>
      </Card>

      <div className="space-y-6">
        <h2 className="text-lg font-semibold">
          All transactions
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
                      variant={granularity === 'monthly' ? 'default' : 'ghost'}
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
    </div>
  );
}
