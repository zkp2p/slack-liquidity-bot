require('dotenv').config();
const { App } = require('@slack/bolt');
const { runLiquidityReport } = require('./sumUsdcByVerifier');

// Simple Slack bot setup
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Handle /liquidity command
app.command('/liquidity', async ({ ack, respond }) => {
  try {
    console.log('🔄 Received /liquidity command');
    await ack();
    
    console.log('📊 Running liquidity report...');
    const message = await runLiquidityReport();
    
    console.log('✅ Sending response to Slack');
    await respond(`🔄 *USDC Totals by Verifier:*\n\n${message}`);
    
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
  await app.start(process.env.PORT || 3000);
  console.log('🚀 Bot is running on port', process.env.PORT || 3000);
  console.log('🔗 Webhook URL: http://localhost:3000/slack/events');
})();
