require('dotenv').config();
const { WebClient } = require('@slack/web-api');
const { runLiquidityReport } = require('./sumUsdcByVerifier');

// Initialize Slack Web API client
const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

// Channel where reports will be sent
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || 'C097Z17A64C'; // Default to your liquidity channel

async function sendHourlyReport() {
  try {
    console.log('🕐 Running hourly liquidity report...');
    
    // Run the liquidity report
    const message = await runLiquidityReport();
    
    // Send to Slack channel
    await slack.chat.postMessage({
      channel: CHANNEL_ID,
      text: `🕐 *Hourly Liquidity Report*\n\n${message}`,
      unfurl_links: false
    });
    
    console.log('✅ Hourly report sent successfully');
    
  } catch (error) {
    console.error('❌ Error sending hourly report:', error);
    
    // Send error notification to Slack
    try {
      await slack.chat.postMessage({
        channel: CHANNEL_ID,
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
  sendHourlyReport();
}

module.exports = { sendHourlyReport }; 