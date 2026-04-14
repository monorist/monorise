import { Hono } from 'hono';
import type { DependencyContainer } from 'monorise/core';

export default (container: DependencyContainer) => {
  const app = new Hono();

  // GET /core/app/summary?start=2024-01-01&end=2024-12-31
  // Returns aggregated totals for transactions in the given date range
  app.get('/summary', async (c) => {
    const start = c.req.query('start');
    const end = c.req.query('end');

    if (!start || !end) {
      return c.json({ error: 'start and end query params required' }, 400);
    }

    const transactions = await container.tagRepository.getTaggedEntities({
      entityType: 'transaction',
      tagName: 'date',
      start,
      end,
    });

    let totalSales = 0;
    let totalRefunds = 0;
    let totalDiscounts = 0;
    let count = 0;

    for (const txn of transactions) {
      const amount = txn.data?.amount ?? 0;
      count++;

      switch (txn.data?.type) {
        case 'sale':
          totalSales += amount;
          break;
        case 'refund':
          totalRefunds += amount;
          break;
        case 'discount':
          totalDiscounts += amount;
          break;
      }
    }

    return c.json({
      start,
      end,
      count,
      totalSales,
      totalRefunds,
      totalDiscounts,
      netTotal: totalSales - totalRefunds - totalDiscounts,
    });
  });

  return app;
};
