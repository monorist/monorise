---
'@monorise/sst': patch
'monorise': patch
---

The built-in CloudWatch dashboard is now disabled by default, because each dashboard adds cost. Set `cloudwatchDashboard: { enabled: true }` to keep it, for example `cloudwatchDashboard: { enabled: $app.stage === 'production' }`. **Breaking:** stages that relied on the old default will have their dashboard destroyed on the next deploy unless they opt in.
