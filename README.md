# Liquidity Bot

A Slack bot that provides automated liquidity reporting for blockchain deposits.

## Features

- **Slash Commands**: `/liquidity` - Get current liquidity report
- **Automated Reports**: Hourly reports sent to Slack channel
- **Blockchain Integration**: Real-time data from Base network
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
