const fs = require('fs');
const { ethers } = require('ethers');
require('dotenv').config();

const ESCROW_ADDRESS = '0xCA38607D85E8F6294Dc10728669605E6664C2D70';
const ABI = require('./escrowAbi.json');

const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
const escrow = new ethers.Contract(ESCROW_ADDRESS, ABI, provider);

const ACTIVE_CACHE_FILE = 'activeDeposits.json';

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

async function scanDeposits() {
  let batchSize = 10;
  const activeDepositIds = new Set();
  const cachedIds = loadCachedIds();

  const depositCount = await escrow.depositCounter();
  console.log(`🔢 Total deposits so far: ${depositCount}`);

  // Re-check cached active deposits
  console.log(`🔄 Rechecking ${cachedIds.length} previously active deposits...`);
  for (const id of cachedIds) {
    try {
      const [deposit] = await escrow.getDepositFromIds([id]);
      if (deposit.deposit.acceptingIntents) {
        activeDepositIds.add(id);
        console.log(`✅ Deposit ${id} still ACTIVE`);
      } else {
        console.log(`❌ Deposit ${id} now INACTIVE`);
      }
    } catch {
      console.log(`⚠️ Failed to fetch deposit ${id}`);
    }
  }

  // Scan from 0 to depositCounter - 1
  console.log(`🔍 Scanning deposits from 0 to ${depositCount}...`);
  for (let i = 0; i < depositCount; i += batchSize) {
    const batch = Array.from({ length: batchSize }, (_, j) => i + j).filter(n => n < depositCount);
    try {
      const result = await escrow.getDepositFromIds(batch);
      for (const deposit of result) {
        const id = deposit.depositId;
        const accepting = deposit.deposit.acceptingIntents;
        if (accepting) {
          if (!activeDepositIds.has(id)) {
            console.log(`🆕 Deposit ${id} is ACTIVE`);
          }
          activeDepositIds.add(id);
        }
      }
    } catch (err) {
      console.error(`❌ Error fetching batch starting at ${i}:`, err.message);
    }
  }

  const finalIds = Array.from(activeDepositIds).map(id => Number(id)).sort((a, b) => a - b);
  saveCachedIds(finalIds);
  console.log(`\n✅ Cached ${finalIds.length} active deposit IDs.`);
}

scanDeposits();
