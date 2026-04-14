import { DependencyContainer } from 'monorise/core';
import config from '../.monorise/config';

const container = new DependencyContainer({
  ...config,
  tableName: process.env.CORE_TABLE,
  eventBusName: process.env.CORE_EVENT_BUS,
});

async function retag() {
  console.log('Fetching all monthly summaries...');

  const { items: summaries } = await container.entityRepository.listEntities({
    entityType: 'monthly-summary' as any,
  });

  console.log(`Found ${summaries.length} monthly summaries. Re-tagging...`);

  let processed = 0;
  for (const summary of summaries) {
    const json = summary.toJSON();
    try {
      // Update with same data to trigger ENTITY_UPDATED event → tag processor re-runs
      await container.entityService.updateEntity({
        entityType: 'monthly-summary' as any,
        entityId: json.entityId,
        entityPayload: { month: json.data.month },
      });
      processed++;
      if (processed % 10 === 0) {
        console.log(`  ${processed}/${summaries.length}`);
      }
    } catch (err: any) {
      console.error(`  Failed ${json.entityId}:`, err?.message);
    }
  }

  console.log(`\nDone! Re-tagged ${processed} monthly summaries.`);
}

retag().catch((err) => {
  console.error('Retag failed:', err);
  process.exit(1);
});
