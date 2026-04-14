import { DependencyContainer } from 'monorise/core';
import config from '../.monorise/config';

const container = new DependencyContainer({
  ...config,
  tableName: process.env.CORE_TABLE,
});

async function migrate() {
  console.log('Fetching all transactions...');

  const { items: transactions } = await container.entityRepository.listEntities({
    entityType: 'transaction' as any,
  });

  console.log(`Found ${transactions.length} transactions`);

  // Group by merchantId + month
  const summaries = new Map<string, {
    merchantId: string;
    month: string;
    totalSales: number;
    totalRefunds: number;
    totalDiscounts: number;
    netTotal: number;
    count: number;
  }>();

  for (const txn of transactions) {
    const data = txn.toJSON().data as any;
    const { merchantId, amount, type, transactionDate } = data;
    if (!merchantId || !amount || !type || !transactionDate) continue;

    const month = transactionDate.slice(0, 7);
    const key = `${merchantId}-${month}`;

    if (!summaries.has(key)) {
      summaries.set(key, {
        merchantId,
        month,
        totalSales: 0,
        totalRefunds: 0,
        totalDiscounts: 0,
        netTotal: 0,
        count: 0,
      });
    }

    const s = summaries.get(key)!;
    s.count++;
    if (type === 'sale') {
      s.totalSales += amount;
      s.netTotal += amount;
    } else if (type === 'refund') {
      s.totalRefunds += amount;
      s.netTotal -= amount;
    } else if (type === 'discount') {
      s.totalDiscounts += amount;
      s.netTotal -= amount;
    }
  }

  console.log(`\nCreating ${summaries.size} monthly summaries...`);

  let created = 0;
  for (const [summaryId, summary] of summaries) {
    try {
      await container.entityService.createEntity({
        entityType: 'monthly-summary' as any,
        entityPayload: {
          ...summary,
          merchantIds: [summary.merchantId],
        },
        entityId: summaryId,
      });
      created++;
      if (created % 20 === 0) {
        console.log(`  ${created}/${summaries.size}`);
      }
    } catch (err: any) {
      if (err?.message?.includes('conditional') || err?.message?.includes('already')) {
        console.log(`  Skipped ${summaryId} (already exists)`);
      } else {
        console.error(`  Failed ${summaryId}:`, err?.message);
      }
    }
  }

  console.log(`\nDone! Created ${created} monthly summaries.`);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
