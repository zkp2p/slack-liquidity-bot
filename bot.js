require('dotenv').config();
const { randomUUID } = require('crypto');
const { App } = require('@slack/bolt');
const { runLiquidityReport } = require('./sumUsdcByVerifier');
const { createComponentLogger, flushLogs } = require('./logger');

const logger = createComponentLogger('bot');

// Simple Slack bot setup
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Handle /liquidity command
app.command('/liquidity', async ({ ack, respond, say, command }) => {
  const requestId = command.trigger_id || randomUUID();
  const commandStartedAt = Date.now();

  logger.info(
    {
      action: 'slack.command.received',
      upstream: 'slack',
      request_id: requestId,
      command: '/liquidity',
      channel_id: command.channel_id,
      user_id: command.user_id,
    },
    'Received /liquidity command'
  );

  try {
    await ack();

    const report = await runLiquidityReport({ requestId });

    const slackSendStartedAt = Date.now();
    await say(report);

    logger.info(
      {
        action: 'slack.command.responded',
        upstream: 'slack',
        request_id: requestId,
        duration_ms: Date.now() - slackSendStartedAt,
        total_duration_ms: Date.now() - commandStartedAt,
      },
      'Sent command response to Slack'
    );
  } catch (err) {
    logger.error(
      {
        action: 'slack.command.error',
        upstream: 'slack',
        request_id: requestId,
        duration_ms: Date.now() - commandStartedAt,
        err,
      },
      'Failed to handle /liquidity command'
    );

    await respond(`❌ Error: ${err.message}`);
  }
});

// Add error handler
app.error((err) => {
  logger.error(
    {
      action: 'slack.app.error',
      upstream: 'slack',
      err,
    },
    'Slack app error'
  );
});

// Start the bot
(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);

  logger.info(
    {
      action: 'service.start',
      port: Number(port),
    },
    'Bot is running'
  );

  logger.info(
    {
      action: 'service.webhook',
      webhook_url: 'https://slack-command-handler-production.up.railway.app/slack/events',
    },
    'Slack webhook URL'
  );
})();

process.on('SIGINT', async () => {
  logger.info(
    {
      action: 'service.shutdown',
      signal: 'SIGINT',
    },
    'Received shutdown signal'
  );
  await flushLogs();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info(
    {
      action: 'service.shutdown',
      signal: 'SIGTERM',
    },
    'Received shutdown signal'
  );
  await flushLogs();
  process.exit(0);
});
