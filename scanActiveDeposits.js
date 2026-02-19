const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { ethers } = require('ethers');
require('dotenv').config();
const { createComponentLogger, flushLogs } = require('./logger');

const logger = createComponentLogger('deposit-scanner');

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
  const jobId = randomUUID();
  const scanStartedAt = Date.now();
  const activeDepositIds = new Set();
  const cachedIds = loadCachedIds();

  logger.info(
    {
      action: 'scanner.job.start',
      job_id: jobId,
    },
    'Starting active deposit scanner'
  );

  const depositCount = await escrow.depositCounter();
  logger.info(
    {
      action: 'deposits.counter.loaded',
      upstream: 'base_rpc',
      job_id: jobId,
      deposit_count: Number(depositCount),
    },
    'Loaded deposit count'
  );

  // Re-check cached active deposits
  logger.info(
    {
      action: 'deposits.cached.recheck.start',
      upstream: 'base_rpc',
      job_id: jobId,
      cached_count: cachedIds.length,
    },
    'Rechecking cached active deposits'
  );

  for (const id of cachedIds) {
    try {
      const deposit = await escrow.getDeposit(id);
      if (deposit.acceptingIntents) {
        activeDepositIds.add(Number(id));
        logger.info(
          {
            action: 'deposits.cached.recheck.active',
            upstream: 'base_rpc',
            job_id: jobId,
            deposit_id: Number(id),
          },
          'Cached deposit is still active'
        );
      } else {
        logger.info(
          {
            action: 'deposits.cached.recheck.inactive',
            upstream: 'base_rpc',
            job_id: jobId,
            deposit_id: Number(id),
          },
          'Cached deposit is no longer active'
        );
      }
    } catch (err) {
      logger.warn(
        {
          action: 'deposits.cached.recheck.error',
          upstream: 'base_rpc',
          job_id: jobId,
          deposit_id: Number(id),
          err,
        },
        'Failed to fetch cached deposit'
      );
    }
  }

  // Scan from 0 to depositCounter - 1
  logger.info(
    {
      action: 'deposits.scan.start',
      upstream: 'base_rpc',
      job_id: jobId,
      max_deposit_id: Number(depositCount),
    },
    'Scanning all deposits'
  );

  const numDepositCount = Number(depositCount);
  for (let i = 0; i < numDepositCount; i++) {
    try {
      const deposit = await escrow.getDeposit(i);
      if (deposit.acceptingIntents) {
        if (!activeDepositIds.has(i)) {
          logger.info(
            {
              action: 'deposits.scan.active_found',
              upstream: 'base_rpc',
              job_id: jobId,
              deposit_id: i,
            },
            'Found new active deposit'
          );
        }
        activeDepositIds.add(i);
      }
    } catch (err) {
      // Deposit might not exist, skip it
      if (!err.message.includes('DepositNotFound')) {
        logger.error(
          {
            action: 'deposits.fetch.error',
            upstream: 'base_rpc',
            job_id: jobId,
            deposit_id: i,
            err,
          },
          'Error fetching deposit'
        );
      }
    }
  }

  const finalIds = Array.from(activeDepositIds)
    .map((id) => Number(id))
    .sort((a, b) => a - b);

  saveCachedIds(finalIds);

  logger.info(
    {
      action: 'scanner.job.finish',
      job_id: jobId,
      active_count: finalIds.length,
      duration_ms: Date.now() - scanStartedAt,
    },
    'Cached active deposit IDs'
  );
}

scanDeposits()
  .catch((err) => {
    logger.error(
      {
        action: 'scanner.job.error',
        err,
      },
      'Active deposit scan failed'
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await flushLogs();
  });
