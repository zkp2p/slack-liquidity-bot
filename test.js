require('dotenv').config();
const { randomUUID } = require('crypto');
const { runLiquidityReport } = require('./sumUsdcByVerifier');
const { createComponentLogger, flushLogs } = require('./logger');

const logger = createComponentLogger('test-runner');

async function test() {
  const requestId = randomUUID();
  const startedAt = Date.now();

  try {
    logger.info(
      {
        action: 'test.run.start',
        request_id: requestId,
      },
      'Testing liquidity report with v3 contracts'
    );

    if (!process.env.BASE_RPC_URL) {
      logger.error(
        {
          action: 'test.config.error',
          request_id: requestId,
        },
        'BASE_RPC_URL environment variable is not set'
      );
      logger.info(
        {
          action: 'test.config.hint',
          request_id: requestId,
        },
        'Set BASE_RPC_URL in .env or export BASE_RPC_URL=https://mainnet.base.org'
      );
      process.exitCode = 1;
      return;
    }

    logger.info(
      {
        action: 'test.config.rpc',
        request_id: requestId,
        upstream: 'base_rpc',
        rpc_url: process.env.BASE_RPC_URL,
      },
      'Using configured RPC'
    );

    logger.info(
      {
        action: 'test.config.escrow',
        request_id: requestId,
        escrow_address: '0x2f121CDDCA6d652f35e8B3E560f9760898888888',
      },
      'Using escrow contract'
    );

    const result = await runLiquidityReport({ requestId });

    logger.info(
      {
        action: 'test.run.finish',
        request_id: requestId,
        duration_ms: Date.now() - startedAt,
      },
      'Report generated successfully'
    );

    logger.info(
      {
        action: 'test.report.output',
        request_id: requestId,
        report: result,
      },
      'Report result'
    );
  } catch (err) {
    logger.error(
      {
        action: 'test.run.error',
        request_id: requestId,
        duration_ms: Date.now() - startedAt,
        err,
      },
      'Error running liquidity report'
    );
    process.exitCode = 1;
  } finally {
    await flushLogs();
  }
}

test();
