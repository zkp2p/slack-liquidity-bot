# Better Stack Alerting and Downtime Detection Plan

This plan is for source `Slack Liquidity Bot Production` (`source_id=1744575`) in team `t504072`.

## Current Better Stack State

- Telemetry source exists and is active.
- Uptime monitor exists for `https://zkp2p.xyz`:
  - https://uptime.betterstack.com/team/t504072/monitors/4074075
- No heartbeats configured.
- No escalation policies configured.
- Default on-call calendar has no users assigned:
  - https://uptime.betterstack.com/team/t504072/oncalls/353411

## Alert Routing

1. Create an escalation policy for production incidents.
2. Add at least one user to on-call rotation.
3. Connect Slack notification channel to that escalation policy.

Without these three steps, critical alerts will not reliably reach Slack responders.

## Recommended Alerts

## 1) Tracing alerts

1. High error span rate
  - Condition: error spans / total spans > 5% for 5m.
  - Severity: high.
2. Latency regression (p95)
  - Condition: p95 duration of root HTTP spans > 1.5s for 10m.
  - Severity: high.
3. Throughput drop
  - Condition: request span count == 0 for 5m during expected traffic windows.
  - Severity: high.

## 2) Log alerts

1. Scheduler failures
  - Match `action=scheduler.job.error`.
  - Trigger on `count >= 1` in 5m.
2. Slack command failures
  - Match `action=slack.command.error`.
  - Trigger on `count >= 3` in 10m.
3. Blockchain/RPC read failures
  - Match `action=deposits.fetch.error`.
  - Trigger on spike (for example, `count >= 5` in 10m).

## 3) Derived SLO alerts (trace + log correlation)

1. Error budget burn
  - Burn alert when 1h error ratio exceeds SLO budget threshold.
2. Slow command response
  - From logs on `total_duration_ms` for `/liquidity`.
  - Trigger if p95 exceeds agreed SLO (example: 3s).

## Downtime Detection

Use all three together for reliable detection:

1. Synthetic checks (Better Uptime monitor)
  - Detects external availability issues.
2. Heartbeat checks (for scheduler/worker processes)
  - The scheduler should ping heartbeat every run.
  - Missing heartbeat means process dead, queue stuck, or scheduler misconfigured.
3. Telemetry silence alert
  - Alert when no logs/traces for service for N minutes.
  - Catches silent crashes where HTTP endpoint may still be up (or vice versa).

## External Dependency Down Detection

For dependencies you call (RPC, Slack API, Discord webhook, Redis, Postgres):

1. Add dedicated synthetic monitors for each dependency health URL when available.
2. Add trace alerts for outbound spans:
  - Error rate by dependency host.
  - Latency spikes by dependency host.
3. Add log alerts for explicit upstream failures:
  - Existing `upstream` field is already present in logs (`slack`, `discord`, `base_rpc`, etc.).

When these are combined, you can distinguish:
- your service is down
- dependency is down
- your service is up but degraded due to dependency failures
