require('dotenv').config();
const { randomUUID } = require('crypto');
const { WebClient } = require('@slack/web-api');
const { runLiquidityReport } = require('./sumUsdcByVerifier');
const { createComponentLogger, flushLogs } = require('./logger');

const logger = createComponentLogger('scheduler');

// Initialize Slack Web API client
const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

// Channel IDs
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || 'C097Z17A64C';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Convert Slack blocks to Discord embed
function convertToDiscordEmbed(slackBlocks) {
  const fields = [];

  for (const block of slackBlocks) {
    if (block.type === 'section' && block.text && block.text.text) {
      // Extract platform and amount from Slack markdown
      const match = block.text.text.match(/\*(.+?)\*: (.+)/);
      if (match) {
        fields.push({
          name: match[1],
          value: `$${match[2]}`,
          inline: true,
        });
      }
    }
  }

  return {
    embeds: [
      {
        title: '💰 Hourly Liquidity Report',
        color: 0x0099ff,
        fields,
        footer: {
          text: '*Liquidity for multiple platforms can be counted twice',
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

async function sendToSlack(report, jobId) {
  const sendStartedAt = Date.now();

  try {
    await slack.chat.postMessage({
      channel: SLACK_CHANNEL_ID,
      text: 'Hourly Liquidity Report',
      blocks: report.blocks,
      unfurl_links: false,
    });

    logger.info(
      {
        action: 'scheduler.slack.send',
        upstream: 'slack',
        job_id: jobId,
        channel_id: SLACK_CHANNEL_ID,
        duration_ms: Date.now() - sendStartedAt,
      },
      'Report sent to Slack'
    );

    return true;
  } catch (err) {
    logger.error(
      {
        action: 'scheduler.slack.error',
        upstream: 'slack',
        job_id: jobId,
        channel_id: SLACK_CHANNEL_ID,
        duration_ms: Date.now() - sendStartedAt,
        err,
      },
      'Error sending report to Slack'
    );
    throw err;
  }
}

async function sendToDiscord(report, jobId) {
  if (!DISCORD_WEBHOOK_URL) {
    logger.info(
      {
        action: 'scheduler.discord.skipped',
        upstream: 'discord',
        job_id: jobId,
      },
      'Skipping Discord because webhook is not configured'
    );
    return true;
  }

  const sendStartedAt = Date.now();

  try {
    const discordPayload = convertToDiscordEmbed(report.blocks);
    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(discordPayload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const error = new Error(`Discord webhook error ${response.status}: ${text}`);
      error.statusCode = response.status;
      throw error;
    }

    logger.info(
      {
        action: 'scheduler.discord.send',
        upstream: 'discord',
        job_id: jobId,
        duration_ms: Date.now() - sendStartedAt,
        status_code: response.status,
      },
      'Report sent to Discord'
    );

    return true;
  } catch (err) {
    logger.error(
      {
        action: 'scheduler.discord.error',
        upstream: 'discord',
        job_id: jobId,
        duration_ms: Date.now() - sendStartedAt,
        status_code: err.statusCode,
        err,
      },
      'Error sending report to Discord'
    );
    return false;
  }
}

async function sendHourlyReport() {
  const jobId = randomUUID();
  const runStartedAt = Date.now();

  logger.info(
    {
      action: 'scheduler.job.start',
      job_id: jobId,
    },
    'Running hourly liquidity report'
  );

  try {
    const report = await runLiquidityReport({ jobId });

    const [slackResult, discordResult] = await Promise.allSettled([
      sendToSlack(report, jobId),
      sendToDiscord(report, jobId),
    ]);

    const slackSuccess = slackResult.status === 'fulfilled' && slackResult.value === true;
    const discordSuccess = discordResult.status === 'fulfilled' && discordResult.value === true;

    if (slackSuccess && discordSuccess) {
      logger.info(
        {
          action: 'scheduler.job.finish',
          job_id: jobId,
          duration_ms: Date.now() - runStartedAt,
        },
        'Hourly report sent to Slack and Discord'
      );
      return;
    }

    if (slackSuccess && !discordSuccess) {
      logger.warn(
        {
          action: 'scheduler.job.partial',
          job_id: jobId,
          duration_ms: Date.now() - runStartedAt,
        },
        'Hourly report sent to Slack only'
      );
      return;
    }

    logger.error(
      {
        action: 'scheduler.job.error',
        job_id: jobId,
        duration_ms: Date.now() - runStartedAt,
      },
      'Failed to send hourly report to Slack'
    );
  } catch (err) {
    logger.error(
      {
        action: 'scheduler.job.error',
        job_id: jobId,
        duration_ms: Date.now() - runStartedAt,
        err,
      },
      'Error generating hourly report'
    );

    // Try to send error notification to Slack
    try {
      await slack.chat.postMessage({
        channel: SLACK_CHANNEL_ID,
        text: `❌ *Hourly Report Error*\n\n${err.message}`,
        unfurl_links: false,
      });

      logger.info(
        {
          action: 'scheduler.slack.error_notification.sent',
          upstream: 'slack',
          job_id: jobId,
          channel_id: SLACK_CHANNEL_ID,
        },
        'Sent Slack error notification'
      );
    } catch (slackError) {
      logger.error(
        {
          action: 'scheduler.slack.error_notification.error',
          upstream: 'slack',
          job_id: jobId,
          channel_id: SLACK_CHANNEL_ID,
          err: slackError,
        },
        'Failed to send Slack error notification'
      );
    }
  }
}

// Run the report immediately if called directly
if (require.main === module) {
  sendHourlyReport().finally(async () => {
    await flushLogs();
    process.exit(0);
  });
}

module.exports = { sendHourlyReport };
