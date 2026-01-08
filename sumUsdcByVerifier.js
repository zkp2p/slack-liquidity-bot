// sumUsdcByVerifier.js
const fs = require('fs');
const { ethers } = require('ethers');

const ESCROW_ADDRESS = '0x2f121CDDCA6d652f35e8B3E560f9760898888888';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ABI = require('./escrowAbi.json');
const ACTIVE_CACHE_FILE = 'activeDeposits.json';
const RATE_LIMIT_DELAY_MS = Number(process.env.RATE_LIMIT_DELAY_MS || 200);

// Payment method ID (bytes32) to platform mapping
const paymentMethodToPlatform = {
  '0x90262a3db0edd0be2369c6b28f9e8511ec0bac7136cefbada0880602f87e7268': 'Venmo',
  '0x617f88ab82b5c1b014c539f7e75121427f0bb50a4c58b187a238531e7d58605d': 'Revolut',
  '0x10940ee67cfb3c6c064569ec92c0ee934cd7afa18dd2ca2d6a2254fcb009c17d': 'Cash App',
  '0x554a007c2217df766b977723b276671aee5ebb4adaea0edb6433c88b3e61dac5': 'Wise',
  '0xa5418819c024239299ea32e09defae8ec412c03e58f5c75f1b2fe84c857f5483': 'Mercado Pago',
  '0x817260692b75e93c7fbc51c71637d4075a975e221e1ebc1abeddfabd731fd90d': 'Zelle', // zelle-citi
  '0x6aa1d1401e79ad0549dced8b1b96fb72c41cd02b32a7d9ea1fed54ba9e17152e': 'Zelle', // zelle-chase
  '0x4bc42b322a3ad413b91b2fde30549ca70d6ee900eded1681de91aaf32ffd7ab5': 'Zelle', // zelle-bofa
  '0x3ccc3d4d5e769b1f82dc4988485551dc0cd3c7a3926d7d8a4dde91507199490f': 'PayPal',
  '0x62c7ed738ad3e7618111348af32691b5767777fbaf46a2d8943237625552645c': 'Monzo',
  '0xd9ff4fd6b39a3e3dd43c41d05662a5547de4a878bc97a65bcb352ade493cdc6b': 'n26',
  '0x5908bb0c9b87763ac6171d4104847667e7f02b4c47b574fe890c1f439ed128bb': 'chime'
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadCachedIds() {
  try {
    return JSON.parse(fs.readFileSync(ACTIVE_CACHE_FILE));
  } catch {
    return [];
  }
}

function saveCachedIds(ids) {
  fs.writeFileSync(ACTIVE_CACHE_FILE, JSON.stringify(ids, null, 2));
}

async function scanActiveDeposits() {
  console.log('🔄 Scanning for active deposits...');
  
  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
  const escrow = new ethers.Contract(ESCROW_ADDRESS, ABI, provider);
  
  const activeDepositIds = new Set();
  const cachedIds = loadCachedIds();

  const depositCount = await escrow.depositCounter();
  console.log(`🔢 Total deposits so far: ${depositCount} (type: ${typeof depositCount})`);

  // Step 1: Re-check cached active deposits
  console.log(`🔄 Step 1: Rechecking ${cachedIds.length} previously active deposits...`);
  for (const id of cachedIds) {
    try {
      const deposit = await escrow.getDeposit(id);
      await delay(RATE_LIMIT_DELAY_MS);
      if (deposit.acceptingIntents) {
        activeDepositIds.add(Number(id));
        console.log(`✅ Deposit ${id} still ACTIVE`);
      } else {
        console.log(`❌ Deposit ${id} now INACTIVE`);
      }
    } catch (err) {
      console.log(`⚠️ Failed to fetch deposit ${id}:`, err.message);
    }
  }

  // Step 2: Find the highest cached ID to start scanning from
  const highestCachedId = cachedIds.length > 0 ? Math.max(...cachedIds.map(id => Number(id))) : -1;
  const startScanFrom = highestCachedId + 1;
  
  console.log(`🔍 Step 2: Scanning NEW deposits from ${startScanFrom} to ${Number(depositCount) - 1}...`);
  
  // Only scan new deposits (from highest cached ID + 1 to current counter)
  const numDepositCount = Number(depositCount);
  for (let i = startScanFrom; i < numDepositCount; i++) {
    try {
      const deposit = await escrow.getDeposit(i);
      await delay(RATE_LIMIT_DELAY_MS);
      if (deposit.acceptingIntents) {
        activeDepositIds.add(i);
        console.log(`🆕 Deposit ${i} is ACTIVE (NEW)`);
      }
    } catch (err) {
      // Deposit might not exist, skip it
      if (!err.message.includes('DepositNotFound')) {
        console.error(`❌ Error fetching deposit ${i}:`, err.message);
      }
    }
  }

  const finalIds = Array.from(activeDepositIds).map(id => Number(id)).sort((a, b) => a - b);
  saveCachedIds(finalIds);
  console.log(`✅ Cached ${finalIds.length} active deposit IDs.`);
  
  return finalIds;
}

function formatLiquidity(platformTotals) {
  // Convert to array and sort by amount (descending)
  const sortedEntries = Object.entries(platformTotals)
    .map(([platform, amount]) => {
      const formatted = parseFloat(ethers.formatUnits(amount, 6)).toFixed(2);
      return { name: platform, formatted, amount };
    })
    .sort((a, b) => parseFloat(b.formatted) - parseFloat(a.formatted));

  // Create Slack blocks
  const blocks = [];

  // Add platform sections
  sortedEntries.forEach(entry => {
    const amount = parseFloat(entry.formatted).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    
    blocks.push({
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": `*${entry.name}*: ${amount}`
      }
    });
  });

  // Add footer
  blocks.push(
    {
      "type": "divider"
    },
    {
      "type": "context",
      "elements": [
        {
          "type": "mrkdwn",
          "text": "_*Liquidity for multiple platforms can be counted twice_"
        }
      ]
    }
  );

  return { blocks };
}

async function runLiquidityReport() {
  // Step 1: Scan deposits and cache them
  console.log('🔍 Step 1: Scanning deposits...');
  const depositIds = await scanActiveDeposits();
  
  // Step 2: Sum USDC from cached data
  console.log('💰 Step 2: Summing USDC...');
  
  console.log('📊 Step 3: Generating liquidity report...');
  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
  const escrow = new ethers.Contract(ESCROW_ADDRESS, ABI, provider);
  
  const platformTotals = {};

  // Process each deposit
  for (const depositId of depositIds) {
    try {
      const deposit = await escrow.getDeposit(depositId);
      await delay(RATE_LIMIT_DELAY_MS);
      
      // Only process USDC deposits
      if (deposit.token.toLowerCase() !== USDC_ADDRESS.toLowerCase()) {
        continue;
      }
      
      // Get payment methods for this deposit
      const paymentMethods = await escrow.getDepositPaymentMethods(depositId);
      await delay(RATE_LIMIT_DELAY_MS);
      
      // Sum liquidity by platform (combining Zelle variants) without double-counting
      const remainingDeposits = BigInt(deposit.remainingDeposits);
      
      for (const paymentMethod of paymentMethods) {
        // Normalize payment method to lowercase for comparison
        const pmLower = paymentMethod.toLowerCase();
        const platform = paymentMethodToPlatform[pmLower];
        
        if (platform) {
          platformTotals[platform] = (platformTotals[platform] || 0n) + remainingDeposits;
        } else {
          console.warn(`⚠️ Unknown payment method: ${paymentMethod}`);
        }
      }
    } catch (err) {
      console.error(`❌ Error processing deposit ${depositId}:`, err.message);
    }
  }

  console.log('📤 Step 4: Report ready to send');
  return formatLiquidity(platformTotals);
}

module.exports = { runLiquidityReport, scanActiveDeposits };
