# Liquidity Bot

A Slack bot that provides automated liquidity reporting for blockchain deposits.

## Features

- **Slash Commands**: `/liquidity` - Get current liquidity report
- **Automated Reports**: Hourly reports sent to Slack channel
- **Blockchain Integration**: Real-time data from Base network
- **OpenTelemetry Tracing**: OTLP trace export to Better Stack with batch processing
- **Pino Trace Correlation**: `trace_id` and `span_id` injected into logs from active context
- **Heroku Deployment**: 24/7 operation with scheduled jobs

## Setup

### 1. Local Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Create `.env` file with required variables
4. Run: `npm start`

### 2. Heroku Deployment

#### Prerequisites
- Heroku account
- Git repository
- Slack app configured

#### Deployment Steps

1. **Create Heroku App**:
   ```bash
   heroku create your-liquidity-bot
   ```

2. **Add Scheduler Addon**:
   ```bash
   heroku addons:create scheduler:standard
   ```

3. **Set Environment Variables**:
   ```bash
   heroku config:set SLACK_BOT_TOKEN=xoxb-your-token
   heroku config:set SLACK_SIGNING_SECRET=your-signing-secret
   heroku config:set SLACK_CLIENT_ID=your-client-id
   heroku config:set SLACK_CLIENT_SECRET=your-client-secret
   heroku config:set SLACK_CHANNEL_ID=C097Z17A64C
   heroku config:set BASE_RPC_URL=https://mainnet.base.org
   ```

4. **Deploy**:
   ```bash
   git add .
   git commit -m "Initial deployment"
   git push heroku main
   ```

5. **Configure Scheduler**:
   - Go to Heroku Dashboard → Your App → Resources
   - Click "Scheduler" addon
   - Add job: `npm run scheduler`
   - Set frequency: "Every hour"

6. **Scale Worker**:
   ```bash
   heroku ps:scale worker=1
   ```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SLACK_BOT_TOKEN` | Bot User OAuth Token | Yes |
| `SLACK_SIGNING_SECRET` | App Signing Secret | Yes |
| `SLACK_CLIENT_ID` | App Client ID | Yes |
| `SLACK_CLIENT_SECRET` | App Client Secret | Yes |
| `SLACK_CHANNEL_ID` | Channel for reports | Yes |
| `BASE_RPC_URL` | Base network RPC URL | Yes |
| `LOG_LEVEL` | Pino log level (`debug`, `info`, `warn`, `error`) | No |
| `SERVICE_NAME` | Service name included in structured logs | No |
| `BETTERSTACK_SOURCE_TOKEN` | Better Stack source token for direct ingestion | No |
| `BETTERSTACK_ENDPOINT` | Better Stack ingest endpoint base URL (for logs and traces; traces use `/v1/traces`) | No |
| `OTEL_TRACING_ENABLED` | Enable tracing bootstrap (`true`/`false`) | No (default `true`) |
| `OTEL_EXPORTER_OTLP_HEADERS` | Standard OTLP exporter headers (`k=v,k2=v2`) | No |
| `OTEL_TRACES_SAMPLE_RATIO` | Parent-based trace sampling ratio (`0.0`-`1.0`) | No (default `0.1`) |
| `OTEL_BSP_MAX_QUEUE_SIZE` | BatchSpanProcessor queue size | No (default `2048`) |
| `OTEL_BSP_MAX_EXPORT_BATCH_SIZE` | BatchSpanProcessor max batch size | No (default `512`) |
| `OTEL_BSP_SCHEDULE_DELAY` | Batch export delay (ms) | No (default `5000`) |
| `OTEL_BSP_EXPORT_TIMEOUT` | Batch export timeout (ms) | No (default `30000`) |
| `OTEL_SHUTDOWN_TIMEOUT` | Tracing shutdown timeout (ms) | No (default `5000`) |

## Structured Log Schema

All runtime logs are JSON and include these normalized fields for Better Stack queries:

- `timestamp`, `level`, `service`, `env`, `schema_version`
- `component`, `action`, `success`, `upstream`
- optional correlation keys: `request_id`, `job_id`
- optional diagnostics: `duration_ms`, `status_code`, `error_message`, `error_stack`, `error_name`
- trace correlation keys when an active span exists: `trace_id`, `span_id`, `trace_flags`

## OpenTelemetry Bootstrap

Tracing is preloaded with `--require ./observability/register.js` in all runtime scripts (`start`, `scheduler`, `scan`, and `test`).

This enables:
- auto instrumentation for `http`, `express`, and `undici` (`fetch`)
- `pino` log correlation via OpenTelemetry's `instrumentation-pino`
- disabled OpenTelemetry log sending (`disableLogSending: true`) so only tracing is used
- graceful trace flush on shutdown through patched `process.exit`

## Usage

### Manual Reports
- Type `/liquidity` in any Slack channel where the bot is present

### Automated Reports
- Reports are sent hourly to the configured Slack channel
- Format: "🕐 Hourly Liquidity Report" with current totals

## Architecture

- **bot.js**: Main Slack bot with slash command handling
- **scheduler.js**: Automated hourly reporting
- **sumUsdcByVerifier.js**: Blockchain data processing
- **data/depositDataCache.json**: Cached deposit data (5 min TTL)

## Monitoring

- Check Heroku logs: `heroku logs --tail`
- Monitor scheduler: Heroku Dashboard → Scheduler
- Slack notifications for errors

## Troubleshooting

1. **Bot not responding**: Check Slack app configuration
2. **Scheduler not running**: Verify scheduler addon is active
3. **Blockchain errors**: Check BASE_RPC_URL and network connectivity
4. **Environment variables**: Ensure all required vars are set in Heroku 
