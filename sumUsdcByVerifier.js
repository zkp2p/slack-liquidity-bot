// sumUsdcByVerifier.js
const fs = require('fs');
const { ethers } = require('ethers');

const ESCROW_ADDRESS = '0xCA38607D85E8F6294Dc10728669605E6664C2D70';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ABI = require('./escrowAbi.json');
const ACTIVE_CACHE_FILE = 'activeDeposits.json';

const verifierMapping = {
  '0x76d33a33068d86016b806df02376ddbb23dd3703': { platform: 'Cash App', isUsdOnly: true },
  '0x9a733b55a875d0db4915c6b36350b24f8ab99df5': { platform: 'Venmo', isUsdOnly: true },
  '0xaa5a1b62b01781e789c900d616300717cd9a41ab': { platform: 'Revolut', isUsdOnly: false },
  '0xff0149799631d7a5bde2e7ea9b306c42b3d9a9ca': { platform: 'Wise', isUsdOnly: false },
  '0x03d17e9371c858072e171276979f6b44571c5dea': { platform: 'PayPal', isUsdOnly: false },
  '0x0de46433bd251027f73ed8f28e01ef05da36a2e0': { platform: 'Monzo', isUsdOnly: false },
  '0xf2ac5be14f32cbe6a613cff8931d95460d6c33a3': { platform: 'Mercado Pago', isUsdOnly: false },
  '0x431a078a5029146aab239c768a615cd484519af7': { platform: 'Zelle', isUsdOnly: true }
};

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
  
  let batchSize = 10;
  const activeDepositIds = new Set();
  const cachedIds = loadCachedIds();

  const depositCount = await escrow.depositCounter();
  console.log(`🔢 Total deposits so far: ${depositCount}`);

  // Step 1: Re-check cached active deposits
  console.log(`🔄 Step 1: Rechecking ${cachedIds.length} previously active deposits...`);
  for (const id of cachedIds) {
    try {
      const [deposit] = await escrow.getDepositFromIds([id]);
      if (deposit.deposit.acceptingIntents) {
        activeDepositIds.add(Number(id));
        console.log(`✅ Deposit ${id} still ACTIVE`);
      } else {
        console.log(`❌ Deposit ${id} now INACTIVE`);
      }
    } catch {
      console.log(`⚠️ Failed to fetch deposit ${id}`);
    }
  }

  // Step 2: Find the highest cached ID to start scanning from
  const highestCachedId = cachedIds.length > 0 ? Math.max(...cachedIds) : -1;
  const startScanFrom = highestCachedId + 1;
  
  console.log(`🔍 Step 2: Scanning NEW deposits from ${startScanFrom} to ${depositCount - 1}...`);
  
  // Only scan new deposits (from highest cached ID + 1 to current counter)
  for (let i = startScanFrom; i < depositCount; i += batchSize) {
    const batch = Array.from({ length: batchSize }, (_, j) => i + j).filter(n => n < depositCount);
    try {
      const result = await escrow.getDepositFromIds(batch);
      for (const deposit of result) {
        const id = deposit.depositId;
        const accepting = deposit.deposit.acceptingIntents;
        if (accepting) {
          activeDepositIds.add(Number(id));
          console.log(`🆕 Deposit ${id} is ACTIVE (NEW)`);
        }
      }
    } catch (err) {
      console.error(`❌ Error fetching batch starting at ${i}:`, err.message);
    }
  }

  const finalIds = Array.from(activeDepositIds).map(id => Number(id)).sort((a, b) => a - b);
  saveCachedIds(finalIds);
  console.log(`✅ Cached ${finalIds.length} active deposit IDs.`);
  
  return finalIds;
}

function formatLiquidity(verifierTotals) {
  // Convert to array and sort by amount (descending)
  const sortedEntries = Object.entries(verifierTotals)
    .map(([verifier, amount]) => {
      const info = verifierMapping[verifier.toLowerCase()];
      const name = info?.platform || verifier;
      const formatted = parseFloat(ethers.formatUnits(amount, 6)).toFixed(2);
      return { name, formatted, amount };
    })
    .sort((a, b) => parseFloat(b.formatted) - parseFloat(a.formatted));

  // Create table header
  let table = '```\n';
  table += '┌─────────────────┬─────────────────┐\n';
  table += '│ Platform        │ USDC Amount     │\n';
  table += '├─────────────────┼─────────────────┤\n';

  // Add rows
  sortedEntries.forEach(entry => {
    const platform = entry.name.padEnd(15);
    const amount = parseFloat(entry.formatted).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(15);
    table += `│ ${platform} │ ${amount} │\n`;
  });

  table += '└─────────────────┴─────────────────┘\n';
  table += '```\n\n';
  table += '_*Liquidity for multiple platforms can be counted twice_';

  return table;
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
  const verifierTotals = {};

  for (let i = 0; i < depositIds.length; i += 10) {
    const batch = depositIds.slice(i, i + 10);
    const results = await escrow.getDepositFromIds(batch);
    for (const d of results) {
      if (d.deposit.token.toLowerCase() !== USDC_ADDRESS.toLowerCase()) continue;
      for (const v of d.verifiers) {
        const addr = v.verifier.toLowerCase();
        const amt = BigInt(d.deposit.remainingDeposits);
        verifierTotals[addr] = (verifierTotals[addr] || 0n) + amt;
      }
    }
  }

  console.log('📤 Step 4: Report ready to send');
  return formatLiquidity(verifierTotals);
}

module.exports = { runLiquidityReport, scanActiveDeposits };