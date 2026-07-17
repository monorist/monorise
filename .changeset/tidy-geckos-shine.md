---
'@monorise/sst': minor
---

Add a `cloudwatchDashboard` option to make the built-in CloudWatch dashboard toggleable. Set `cloudwatchDashboard: { enabled: false }` to skip creating the dashboard — useful for test and personal stages where the dashboard would only add cost. Defaults to enabled, so existing stages are unaffected. Note: disabling it on a stage where the dashboard already exists will destroy the dashboard on the next deploy.
