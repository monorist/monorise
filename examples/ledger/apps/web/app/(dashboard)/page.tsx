'use client';

import { useState, useMemo } from 'react';
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
import MerchantLineChart from '#/components/merchant-line-chart';
import MerchantSelector from '#/components/merchant-selector';

type Granularity = 'daily' | 'monthly';

export default function HomePage() {
  const defaults = getDefaultDateRange();
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [tab, setTab] = useState('list');
  const [granularity, setGranularity] = useState<Granularity>('monthly');
  const [selectedMerchantIds, setSelectedMerchantIds] = useState<string[]>([]);
  const [hasAutoSelected, setHasAutoSelected] = useState(false);

  const { entities: merchants } = useEntities(Entity.MERCHANT);
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

  // Fetch monthly summaries for the line chart
  const { entities: monthlySummaries } = useTaggedEntities(
    Entity.MONTHLY_SUMMARY,
    'month',
    {
      params: {
        start: monthToStartDate(start),
        end: monthToEndDate(end),
      },
    },
  );

  // Auto-select top 10 merchants by net total
  const top10MerchantIds = useMemo(() => {
    if (!monthlySummaries?.length) return [];

    const totals = new Map<string, number>();
    for (const s of monthlySummaries) {
      const mid = s.data.merchantId;
      totals.set(mid, (totals.get(mid) ?? 0) + (s.data.netTotal ?? 0));
    }

    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);
  }, [monthlySummaries]);

  // Set default selection once
  if (!hasAutoSelected && top10MerchantIds.length > 0) {
    setSelectedMerchantIds(top10MerchantIds);
    setHasAutoSelected(true);
  }

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

      {/* Top Merchants Line Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Top merchants from {formatMonthLabel(start)} to{' '}
            {formatMonthLabel(end)}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <MerchantSelector
            merchants={merchants ?? []}
            selectedIds={selectedMerchantIds}
            onSelectionChange={setSelectedMerchantIds}
          />
          {monthlySummaries && monthlySummaries.length > 0 ? (
            <MerchantLineChart
              summaries={monthlySummaries as any}
              merchants={merchants ?? []}
              selectedMerchantIds={selectedMerchantIds}
              startMonth={start}
              endMonth={end}
            />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No monthly summary data available. Run the migration script or create transactions to generate summaries.
            </p>
          )}
        </CardContent>
      </Card>

      {/* All Transactions */}
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
