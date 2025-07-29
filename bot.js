require('dotenv').config();
const { App } = require('@slack/bolt');
const { runLiquidityReport } = require('./sumUsdcByVerifier');

// Simple Slack bot setup
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Handle /liquidity command
app.command('/liquidity', async ({ ack, respond, say, command }) => {
  try {
    console.log('🔄 Received /liquidity command');
    await ack();
    
    console.log('📊 Running liquidity report...');
    const report = await runLiquidityReport();
    
    console.log('✅ Sending response to Slack');
    // Post to the channel where the command was used
    await say(report);
    
  } catch (error) {
    console.error('❌ Error:', error);
    await respond(`❌ Error: ${error.message}`);
  }
});

// Add error handler
app.error((error) => {
  console.error('❌ Slack app error:', error);
});

// Start the bot
(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log('🚀 Bot is running on port', port);
  console.log('🔗 Webhook URL: https://zkp2p-liquidity-bot-c365013bc1a9.herokuapp.com/slack/events');
})();
