import 'tsx';
import { DependencyContainer } from 'monorise/core';
import config, { Entity } from '../.monorise/config';

const CONCURRENCY = 20;

const container = new DependencyContainer({
  ...config,
  tableName: process.env.CORE_TABLE,
});

async function runConcurrent<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
  label: string,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  let completed = 0;
  let failed = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await fn(items[i]);
      } catch (err: any) {
        failed++;
        if (failed <= 5) console.error(`  Failed: ${err.message}`);
        results[i] = undefined as any;
      }
      completed++;
      if (completed % 200 === 0 || completed === items.length) {
        console.log(`  ${label}: ${completed}/${items.length}${failed ? ` (${failed} failed)` : ''}`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(startDate: Date, endDate: Date) {
  const start = startDate.getTime();
  const end = endDate.getTime();
  return new Date(start + Math.random() * (end - start)).toISOString();
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const merchantNames = [
  'Coffee House', 'Tech Store', 'Green Grocers', 'Urban Fashion', 'Book Haven',
  'Fitness Hub', 'Pet Paradise', 'Auto Parts Co', 'Home Essentials', 'Garden Center',
];

const merchantCategories = [
  'food-beverage', 'electronics', 'grocery', 'fashion', 'books',
  'fitness', 'pets', 'automotive', 'home', 'garden',
];

const firstNames = [
  'Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry',
  'Ivy', 'Jack', 'Kate', 'Leo', 'Mia', 'Noah', 'Olivia', 'Peter',
  'Quinn', 'Ruby', 'Sam', 'Tina', 'Uma', 'Victor', 'Wendy', 'Xavier',
  'Yara', 'Zack', 'Amy', 'Ben', 'Chloe', 'Dan', 'Emma', 'Finn',
  'Gina', 'Hugo', 'Iris', 'Jake', 'Lily', 'Max', 'Nora', 'Oscar',
];

const lastNames = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
  'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Wilson',
  'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee',
  'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez',
  'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright',
  'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green',
];

const descriptions = [
  'Morning coffee', 'Weekly groceries', 'Electronics purchase', 'Clothing item',
  'Book order', 'Gym membership', 'Pet food', 'Car parts', 'Home decor',
  'Garden supplies', 'Lunch order', 'Gift card', 'Subscription renewal',
  'Online order', 'In-store purchase', 'Seasonal sale item', 'Bulk order',
  'Express delivery', 'Return item', 'Loyalty reward',
];

const txnTypes = ['sale', 'sale', 'sale', 'sale', 'sale', 'sale', 'refund', 'discount'] as const;
const statuses = ['completed', 'completed', 'completed', 'completed', 'pending'] as const;

async function seed() {
  const dateEnd = new Date();
  const dateStart = new Date();
  dateStart.setMonth(dateStart.getMonth() - 7);

  const { entityService } = container;

  // --- Seed merchants ---
  console.log('Creating 10 merchants...');
  const merchantIds: string[] = [];

  for (let i = 0; i < 10; i++) {
    const entity = await entityService.createEntity({
      entityType: Entity.MERCHANT as any,
      entityPayload: {
        name: merchantNames[i],
        category: merchantCategories[i],
        contactEmail: `${merchantNames[i].toLowerCase().replace(/\s/g, '')}@example.com`,
      },
    });
    merchantIds.push(entity.entityId);
    console.log(`  [${i + 1}/10] ${merchantNames[i]} (${entity.entityId})`);
  }

  // --- Seed buyers ---
  console.log('\nCreating 1000 buyers...');
  const buyerPayloads = Array.from({ length: 1000 }, (_, i) => ({
    name: `${randomItem(firstNames)} ${randomItem(lastNames)}`,
    email: `buyer${i.toString().padStart(4, '0')}@example.com`,
  }));

  const buyerResults = await runConcurrent(
    buyerPayloads,
    (payload) =>
      entityService.createEntity({
        entityType: Entity.BUYER as any,
        entityPayload: payload,
      }),
    CONCURRENCY,
    'Buyers',
  );
  const buyerIds = buyerResults.filter(Boolean).map((r) => r.entityId);
  console.log(`  ${buyerIds.length} buyers created`);

  // --- Seed transactions ---
  let totalTxn = 0;

  for (let m = 0; m < merchantIds.length; m++) {
    const merchantId = merchantIds[m];
    const txnCount = randomInt(800, 1000);

    console.log(
      `\nMerchant ${m + 1}/${merchantIds.length} (${merchantNames[m]}): ${txnCount} transactions`,
    );

    const txnPayloads = Array.from({ length: txnCount }, () => {
      const buyerId = randomItem(buyerIds);
      const type = randomItem(txnTypes);
      const amount =
        type === 'sale'
          ? randomInt(500, 50000)
          : type === 'refund'
            ? randomInt(200, 20000)
            : randomInt(100, 5000);

      return {
        amount,
        type,
        description: randomItem(descriptions),
        transactionDate: randomDate(dateStart, dateEnd),
        status: randomItem(statuses),
        merchantId,
        buyerId,
      };
    });

    await runConcurrent(
      txnPayloads,
      (payload) =>
        entityService.createEntity({
          entityType: Entity.TRANSACTION as any,
          entityPayload: payload,
        }),
      CONCURRENCY,
      `Merchant ${m + 1} txns`,
    );

    totalTxn += txnCount;
  }

  console.log(`\nDone! Created:`);
  console.log(`  - ${merchantIds.length} merchants`);
  console.log(`  - ${buyerIds.length} buyers`);
  console.log(`  - ${totalTxn} transactions`);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
