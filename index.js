require('dotenv').config();
const { App } = require('@slack/bolt');
const { ethers } = require('ethers');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);

const usdcAbi = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

const usdc = new ethers.Contract(process.env.USDC_ADDRESS, usdcAbi, provider);

app.message(/usdc holdings/i, async ({ message, say }) => {
  try {
    const balance = await usdc.balanceOf(process.env.MONITORED_ADDRESS);
    const decimals = await usdc.decimals();
    const formatted = ethers.formatUnits(balance, decimals);
    await say(`USDC balance of ${process.env.MONITORED_ADDRESS} is ${formatted} USDC`);
  } catch (error) {
    console.error(error);
    await say('Error fetching USDC holdings.');
  }
});

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('🚀 liquidity-bot running on port', process.env.PORT || 3000);
})();
