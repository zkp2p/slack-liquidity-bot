require('dotenv').config();
const { WebClient } = require('@slack/web-api');
const axios = require('axios');
const { runLiquidityReport } = require('./sumUsdcByVerifier');

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
          inline: true
        });
      }
    }
  }

  return {
    embeds: [{
      title: '💰 Hourly Liquidity Report',
      color: 0x0099FF,
      fields: fields,
      footer: {
        text: '*Liquidity for multiple platforms can be counted twice'
      },
      timestamp: new Date().toISOString()
    }]
  };
}

async function sendToSlack(report) {
  try {
    await slack.chat.postMessage({
      channel: SLACK_CHANNEL_ID,
      text: 'Hourly Liquidity Report',
      blocks: report.blocks,
      unfurl_links: false
    });
    console.log('✅ Report sent to Slack');
  } catch (error) {
    console.error('❌ Error sending to Slack:', error);
    throw error;
  }
}

async function sendToDiscord(report) {
  if (!DISCORD_WEBHOOK_URL) {
    console.log('⏭️ Skipping Discord (webhook not configured)');
    return;
  }

  try {
    const discordPayload = convertToDiscordEmbed(report.blocks);
    await axios.post(DISCORD_WEBHOOK_URL, discordPayload);
    console.log('✅ Report sent to Discord');
  } catch (error) {
    console.error('❌ Error sending to Discord:', error);
    // Don't throw - we don't want Discord errors to stop Slack reports
  }
}

async function sendHourlyReport() {
  try {
    console.log('🕐 Running hourly liquidity report...');
    
    // Run the liquidity report
    const report = await runLiquidityReport();
    
    // Send to both platforms
    const results = await Promise.allSettled([
      sendToSlack(report),
      sendToDiscord(report)
    ]);

    // Check if both succeeded
    const slackSuccess = results[0].status === 'fulfilled';
    const discordSuccess = results[1].status === 'fulfilled';

    if (slackSuccess && discordSuccess) {
      console.log('✅ Hourly report sent successfully to both platforms');
    } else if (slackSuccess) {
      console.log('⚠️ Report sent to Slack only (Discord failed or not configured)');
    } else {
      console.error('❌ Failed to send report');
    }
    
  } catch (error) {
    console.error('❌ Error generating hourly report:', error);
    
    // Try to send error notification to Slack
    try {
      await slack.chat.postMessage({
        channel: SLACK_CHANNEL_ID,
        text: `❌ *Hourly Report Error*\n\n${error.message}`,
        unfurl_links: false
      });
    } catch (slackError) {
      console.error('❌ Failed to send error notification:', slackError);
    }
  }
}

// Run the report immediately if called directly
if (require.main === module) {
  sendHourlyReport().then(() => {
    process.exit(0);
  });
}

module.exports = { sendHourlyReport };