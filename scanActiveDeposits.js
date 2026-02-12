const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config();

const ESCROW_ADDRESS = '0x2f121CDDCA6d652f35e8B3E560f9760898888888';
const ABI = require('./escrowAbi.json');

const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
const escrow = new ethers.Contract(ESCROW_ADDRESS, ABI, provider);

const DATA_DIR = path.join(__dirname, 'data');
const ACTIVE_CACHE_FILE = path.join(DATA_DIR, 'activeDeposits.json');

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadCachedIds() {
  try {
    return JSON.parse(fs.readFileSync(ACTIVE_CACHE_FILE));
  } catch {
    return [];
  }
}

function saveCachedIds(ids) {
  ensureDataDir();
  fs.writeFileSync(ACTIVE_CACHE_FILE, JSON.stringify(ids, null, 2));
}

async function scanDeposits() {
  const activeDepositIds = new Set();
  const cachedIds = loadCachedIds();

  const depositCount = await escrow.depositCounter();
  console.log(`🔢 Total deposits so far: ${depositCount}`);

  // Re-check cached active deposits
  console.log(`🔄 Rechecking ${cachedIds.length} previously active deposits...`);
  for (const id of cachedIds) {
    try {
      const deposit = await escrow.getDeposit(id);
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

  // Scan from 0 to depositCounter - 1
  console.log(`🔍 Scanning deposits from 0 to ${depositCount}...`);
  const numDepositCount = Number(depositCount);
  for (let i = 0; i < numDepositCount; i++) {
    try {
      const deposit = await escrow.getDeposit(i);
      if (deposit.acceptingIntents) {
        if (!activeDepositIds.has(i)) {
          console.log(`🆕 Deposit ${i} is ACTIVE`);
        }
        activeDepositIds.add(i);
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
  console.log(`\n✅ Cached ${finalIds.length} active deposit IDs.`);
}

scanDeposits();
