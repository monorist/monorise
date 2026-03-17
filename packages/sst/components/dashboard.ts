export function createFunctionWidgets(
  title: string,
  functionName: string,
  y: number,
  region: string,
  dlqName?: string,
) {
  const hasDlq = !!dlqName;
  const w = hasDlq ? 4 : 5;
  const widgets: object[] = [];
  let x = 0;

  // Section header
  widgets.push({
    type: 'text',
    x: 0,
    y,
    width: 24,
    height: 1,
    properties: {
      markdown: `## ${title}`,
    },
  });

  const metricY = y + 1;

  widgets.push({
    type: 'metric',
    x,
    y: metricY,
    width: w,
    height: 6,
    properties: {
      metrics: [
        ['AWS/Lambda', 'Invocations', 'FunctionName', functionName],
      ],
      title: 'Invocations',
      stat: 'Sum',
      period: 300,
      region,
    },
  });
  x += w;

  widgets.push({
    type: 'metric',
    x,
    y: metricY,
    width: w,
    height: 6,
    properties: {
      metrics: [
        [
          'AWS/Lambda',
          'Duration',
          'FunctionName',
          functionName,
          { label: 'Avg' },
        ],
        ['...', { stat: 'p99', label: 'p99' }],
      ],
      title: 'Duration (ms)',
      stat: 'Average',
      period: 300,
      region,
    },
  });
  x += w;

  widgets.push({
    type: 'metric',
    x,
    y: metricY,
    width: w,
    height: 6,
    properties: {
      metrics: [
        ['AWS/Lambda', 'Errors', 'FunctionName', functionName],
      ],
      title: 'Errors',
      stat: 'Sum',
      period: 300,
      region,
    },
  });
  x += w;

  widgets.push({
    type: 'metric',
    x,
    y: metricY,
    width: w,
    height: 6,
    properties: {
      metrics: [
        [
          {
            expression: '100 - 100 * errors / invocations',
            label: 'Success Rate (%)',
            id: 'successRate',
          },
        ],
        [
          'AWS/Lambda',
          'Invocations',
          'FunctionName',
          functionName,
          { id: 'invocations', visible: false },
        ],
        [
          'AWS/Lambda',
          'Errors',
          'FunctionName',
          functionName,
          { id: 'errors', visible: false },
        ],
      ],
      title: 'Success Rate (%)',
      stat: 'Sum',
      period: 300,
      region,
      yAxis: { left: { min: 0, max: 100 } },
    },
  });
  x += w;

  const concurrentW = hasDlq ? w : 24 - x;
  widgets.push({
    type: 'metric',
    x,
    y: metricY,
    width: concurrentW,
    height: 6,
    properties: {
      metrics: [
        [
          'AWS/Lambda',
          'ConcurrentExecutions',
          'FunctionName',
          functionName,
        ],
      ],
      title: 'Concurrent Executions',
      stat: 'Maximum',
      period: 300,
      region,
    },
  });
  x += concurrentW;

  if (dlqName) {
    widgets.push({
      type: 'metric',
      x,
      y: metricY,
      width: 24 - x,
      height: 6,
      properties: {
        metrics: [
          [
            'AWS/SQS',
            'ApproximateNumberOfMessagesVisible',
            'QueueName',
            dlqName,
          ],
        ],
        title: 'DLQ Messages',
        stat: 'Maximum',
        period: 300,
        region,
      },
    });
  }

  return widgets;
}
