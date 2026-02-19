const { Writable } = require('stream');
const pino = require('pino');

const SERVICE_NAME = process.env.SERVICE_NAME || 'slack-liquidity-bot';
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();

const BETTERSTACK_SOURCE_TOKEN = process.env.BETTERSTACK_SOURCE_TOKEN || '';
const BETTERSTACK_ENDPOINT = (
  process.env.BETTERSTACK_ENDPOINT ||
  'https://in.logs.betterstack.com'
).replace(/\/+$/, '');

const inflightRequests = new Set();

function extractErrorFields(err) {
  if (!err) return {};

  if (err instanceof Error) {
    return {
      error_message: err.message,
      error_stack: err.stack,
      error_name: err.name,
    };
  }

  if (typeof err === 'string') {
    return {
      error_message: err,
    };
  }

  if (typeof err === 'object') {
    return {
      error_message: err.message || err.error_message,
      error_stack: err.stack || err.error_stack,
      error_name: err.name || err.type || err.error_name,
    };
  }

  return {};
}

function normalizeLogObject(logObject = {}) {
  const normalized = { ...logObject };

  const errorFields = extractErrorFields(normalized.err || normalized.error);
  if (errorFields.error_message && !normalized.error_message) {
    normalized.error_message = errorFields.error_message;
  }
  if (errorFields.error_stack && !normalized.error_stack) {
    normalized.error_stack = errorFields.error_stack;
  }
  if (errorFields.error_name && !normalized.error_name) {
    normalized.error_name = errorFields.error_name;
  }

  if (!normalized.action) {
    normalized.action = 'runtime.event';
  }
  if (!normalized.upstream) {
    normalized.upstream = 'internal';
  }
  if (typeof normalized.success !== 'boolean') {
    normalized.success = !Boolean(normalized.error_message);
  }

  return normalized;
}

function sendToBetterStack(payload) {
  if (!BETTERSTACK_SOURCE_TOKEN) {
    return;
  }

  const request = fetch(BETTERSTACK_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${BETTERSTACK_SOURCE_TOKEN}`,
      'x-source-token': BETTERSTACK_SOURCE_TOKEN,
    },
    body: payload,
  })
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      inflightRequests.delete(request);
    });

  inflightRequests.add(request);
}

class BetterStackStream extends Writable {
  constructor() {
    super();
    this.buffer = '';
  }

  _write(chunk, _encoding, callback) {
    this.buffer += chunk.toString('utf8');

    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        sendToBetterStack(trimmed);
      }
    }

    callback();
  }

  _final(callback) {
    const trimmed = this.buffer.trim();
    if (trimmed.length > 0) {
      sendToBetterStack(trimmed);
    }
    this.buffer = '';
    callback();
  }
}

const streams = [{ stream: process.stdout }];
if (BETTERSTACK_SOURCE_TOKEN) {
  streams.push({ stream: new BetterStackStream() });
}

const rootLogger = pino(
  {
    level: LOG_LEVEL,
    base: {
      service: SERVICE_NAME,
      env: process.env.NODE_ENV || 'development',
      schema_version: 1,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'message',
    formatters: {
      level(label) {
        return { level: label };
      },
      log(logObject) {
        return normalizeLogObject(logObject);
      },
    },
    serializers: {
      err: pino.stdSerializers.err,
    },
    hooks: {
      logMethod(args, method, level) {
        if (level >= 50) {
          if (args.length > 0 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
            if (typeof args[0].success !== 'boolean') {
              args[0] = { ...args[0], success: false };
            }
          } else {
            args.unshift({ success: false });
          }
        }
        method.apply(this, args);
      },
    },
  },
  pino.multistream(streams)
);

function createComponentLogger(component, bindings = {}) {
  return rootLogger.child({ component, ...bindings });
}

const logger = createComponentLogger('runtime');

async function flushLogs() {
  if (inflightRequests.size === 0) {
    return;
  }

  await Promise.allSettled(Array.from(inflightRequests));
}

module.exports = {
  logger,
  createComponentLogger,
  flushLogs,
};
