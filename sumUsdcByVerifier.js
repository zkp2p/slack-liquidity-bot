// sumUsdcByVerifier.js - Optimized for minimal RPC calls
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const ESCROW_ADDRESS = '0x2f121CDDCA6d652f35e8B3E560f9760898888888';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ABI = require('./escrowAbi.json');
const DATA_DIR = path.join(__dirname, 'data');
const DEPOSIT_DATA_CACHE_FILE = path.join(DATA_DIR, 'depositDataCache.json');

// Configuration
const RATE_LIMIT_DELAY_MS = Number(process.env.RATE_LIMIT_DELAY_MS || 300);
const BATCH_SIZE = 3; // Concurrent requests per batch (conservative for rate limits)
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minute TTL

// Payment method ID (bytes32) to platform mapping
const paymentMethodToPlatform = {
  '0x90262a3db0edd0be2369c6b28f9e8511ec0bac7136cefbada0880602f87e7268': 'Venmo',
  '0x617f88ab82b5c1b014c539f7e75121427f0bb50a4c58b187a238531e7d58605d': 'Revolut',
  '0x10940ee67cfb3c6c064569ec92c0ee934cd7afa18dd2ca2d6a2254fcb009c17d': 'Cash App',
  '0x554a007c2217df766b977723b276671aee5ebb4adaea0edb6433c88b3e61dac5': 'Wise',
  '0xa5418819c024239299ea32e09defae8ec412c03e58f5c75f1b2fe84c857f5483': 'Mercado Pago',
  '0x817260692b75e93c7fbc51c71637d4075a975e221e1ebc1abeddfabd731fd90d': 'Zelle',
  '0x6aa1d1401e79ad0549dced8b1b96fb72c41cd02b32a7d9ea1fed54ba9e17152e': 'Zelle',
  '0x4bc42b322a3ad413b91b2fde30549ca70d6ee900eded1681de91aaf32ffd7ab5': 'Zelle',
  '0x3ccc3d4d5e769b1f82dc4988485551dc0cd3c7a3926d7d8a4dde91507199490f': 'PayPal',
  '0x62c7ed738ad3e7618111348af32691b5767777fbaf46a2d8943237625552645c': 'Monzo',
  '0xd9ff4fd6b39a3e3dd43c41d05662a5547de4a878bc97a65bcb352ade493cdc6b': 'n26',
  '0x5908bb0c9b87763ac6171d4104847667e7f02b4c47b574fe890c1f439ed128bb': 'chime'
};

// Singleton provider instance
let providerInstance = null;
let escrowInstance = null;

function getProvider() {
  if (!providerInstance) {
    providerInstance = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
  }
  return providerInstance;
}

function getEscrow() {
  if (!escrowInstance) {
    escrowInstance = new ethers.Contract(ESCROW_ADDRESS, ABI, getProvider());
  }
  return escrowInstance;
}

// In-memory cache with TTL
const memoryCache = {
  deposits: {},
  lastFullScan: null
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Load/save deposit data cache (persists across restarts)
function loadDepositDataCache() {
  try {
    const data = JSON.parse(fs.readFileSync(DEPOSIT_DATA_CACHE_FILE));
    // Restore to memory cache if not expired
    const now = Date.now();
    for (const [id, entry] of Object.entries(data)) {
      if (now - entry.timestamp < CACHE_TTL_MS) {
        memoryCache.deposits[id] = entry;
      }
    }
    return data;
  } catch {
    return {};
  }
}

function pruneExpiredDepositDataCache() {
  const now = Date.now();
  for (const [id, entry] of Object.entries(memoryCache.deposits)) {
    if (!entry || typeof entry.timestamp !== 'number' || now - entry.timestamp >= CACHE_TTL_MS) {
      delete memoryCache.deposits[id];
    }
  }
}

function saveDepositDataCache() {
  ensureDataDir();
  pruneExpiredDepositDataCache();
  fs.writeFileSync(DEPOSIT_DATA_CACHE_FILE, JSON.stringify(memoryCache.deposits, null, 2));
}

// Check if cached deposit data is still valid
function getCachedDeposit(depositId) {
  const cached = memoryCache.deposits[depositId];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached;
  }
  return null;
}

// Parallel batch processor with rate limiting
async function processBatches(items, processor, batchSize = BATCH_SIZE) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
    if (i + batchSize < items.length) {
      await delay(RATE_LIMIT_DELAY_MS);
    }
  }
  return results;
}

// Fetch deposit with caching
async function fetchDeposit(escrow, depositId) {
  const cached = getCachedDeposit(depositId);
  if (cached) {
    return { id: depositId, ...cached, fromCache: true };
  }

  try {
    const deposit = await escrow.getDeposit(depositId);
    const isUsdc = deposit.token.toLowerCase() === USDC_ADDRESS.toLowerCase();

    // Only fetch payment methods for USDC deposits
    let paymentMethods = [];
    if (isUsdc && deposit.acceptingIntents) {
      paymentMethods = await escrow.getDepositPaymentMethods(depositId);
    }

    const depositData = {
      token: deposit.token,
      remainingDeposits: deposit.remainingDeposits.toString(),
      acceptingIntents: deposit.acceptingIntents,
      isUsdc,
      paymentMethods: paymentMethods.map(pm => pm.toLowerCase()),
      timestamp: Date.now()
    };

    memoryCache.deposits[depositId] = depositData;
    return { id: depositId, ...depositData, fromCache: false };
  } catch (err) {
    if (!err.message.includes('DepositNotFound')) {
      console.error(`❌ Error fetching deposit ${depositId}:`, err.message);
    }
    return null;
  }
}

// Main optimized scan - single pass, returns full data
async function scanActiveDeposits() {
  console.log('🔄 Scanning for active deposits (optimized)...');

  // Load any persisted cache
  loadDepositDataCache();

  const escrow = getEscrow();

  // Get deposit count (1 RPC call)
  const depositCount = await escrow.depositCounter();
  const numDepositCount = Number(depositCount);
  console.log(`🔢 Total deposits: ${numDepositCount}`);

  const needsFetch = [];
  const fromCacheResults = [];

  for (let id = 0; id < numDepositCount; id++) {
    const cached = getCachedDeposit(id);
    if (cached) {
      fromCacheResults.push({ id, ...cached, fromCache: true });
    } else {
      needsFetch.push(id);
    }
  }

  console.log(`📦 Using ${fromCacheResults.length} cached deposits, fetching ${needsFetch.length} deposits`);

  // Fetch deposits in parallel batches
  const fetchedResults = await processBatches(
    needsFetch,
    async (id) => fetchDeposit(escrow, id)
  );

  // Combine results
  const allResults = [...fromCacheResults, ...fetchedResults].filter(Boolean);

  // Filter to active deposits only
  const activeDeposits = allResults.filter(d => d.acceptingIntents);

  // Save caches
  saveDepositDataCache();

  const activeFromCache = activeDeposits.filter(d => d.fromCache).length;
  console.log(`✅ Found ${activeDeposits.length} active deposits (${activeFromCache} from cache)`);

  return activeDeposits;
}

function formatLiquidity(platformTotals) {
  const sortedEntries = Object.entries(platformTotals)
    .map(([platform, amount]) => {
      const formatted = parseFloat(ethers.formatUnits(amount, 6)).toFixed(2);
      return { name: platform, formatted, amount };
    })
    .sort((a, b) => parseFloat(b.formatted) - parseFloat(a.formatted));

  const blocks = [];

  sortedEntries.forEach(entry => {
    const amount = parseFloat(entry.formatted).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    blocks.push({
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": `*${entry.name}*: ${amount}`
      }
    });
  });

  blocks.push(
    { "type": "divider" },
    {
      "type": "context",
      "elements": [{
        "type": "mrkdwn",
        "text": "_*Liquidity for multiple platforms can be counted twice_"
      }]
    }
  );

  return { blocks };
}

async function runLiquidityReport() {
  console.log('📊 Running optimized liquidity report...');

  // Single pass: scan returns full deposit data with payment methods
  const activeDeposits = await scanActiveDeposits();

  // Filter to USDC and sum by platform (no additional RPC calls needed!)
  const platformTotals = {};
  let usdcCount = 0;

  for (const deposit of activeDeposits) {
    if (!deposit.isUsdc) continue;
    usdcCount++;

    const remainingDeposits = BigInt(deposit.remainingDeposits);

    for (const paymentMethod of deposit.paymentMethods) {
      const platform = paymentMethodToPlatform[paymentMethod];
      if (platform) {
        platformTotals[platform] = (platformTotals[platform] || 0n) + remainingDeposits;
      } else {
        console.warn(`⚠️ Unknown payment method: ${paymentMethod}`);
      }
    }
  }

  console.log(`💰 Processed ${usdcCount} USDC deposits`);
  console.log('📤 Report ready');

  return formatLiquidity(platformTotals);
}

// Export for backwards compatibility
module.exports = { runLiquidityReport, scanActiveDeposits };
