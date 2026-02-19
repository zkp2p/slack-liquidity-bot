const assert = require('node:assert/strict');
const test = require('node:test');

const REGISTER_PATH = require.resolve('../observability/register');
const TRACING_PATH = require.resolve('../observability/tracing');

function loadRegisterModule(disabledValue) {
  delete require.cache[REGISTER_PATH];
  process.env.OTEL_BOOTSTRAP_DISABLED = disabledValue;
  return require('../observability/register');
}

function waitForMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('bootstrapTracing runs automatically when OTEL_BOOTSTRAP_DISABLED is not 1', async () => {
  const tracing = require('../observability/tracing');
  const originalInit = tracing.initTracing;
  const originalShutdown = tracing.shutdownTracing;
  const originalExit = process.exit;

  let initCalls = 0;
  const shutdownCalls = [];
  const exitCalls = [];

  tracing.initTracing = () => {
    initCalls += 1;
  };
  tracing.shutdownTracing = async (options) => {
    shutdownCalls.push(options || {});
  };
  process.exit = (code) => {
    exitCalls.push(code);
  };

  const register = loadRegisterModule('0');

  assert.equal(initCalls, 1);

  process.listeners('SIGINT')[0]();
  process.listeners('SIGTERM')[0]();
  process.listeners('beforeExit')[0]();
  await waitForMicrotasks();
  assert.equal(shutdownCalls.length, 3);

  process.exit(9);
  await waitForMicrotasks();
  assert.deepEqual(exitCalls, [9]);

  register.resetGracefulShutdownForTests();
  process.exit = originalExit;
  tracing.initTracing = originalInit;
  tracing.shutdownTracing = originalShutdown;
});

test('installGracefulShutdown is idempotent and wraps process.exit once', async () => {
  const tracing = require('../observability/tracing');
  const originalShutdown = tracing.shutdownTracing;
  const originalExit = process.exit;

  const shutdownCalls = [];
  const exitCalls = [];

  tracing.shutdownTracing = async (options) => {
    shutdownCalls.push(options || {});
  };
  process.exit = (code) => {
    exitCalls.push(code);
  };

  const register = loadRegisterModule('1');
  register.installGracefulShutdown({ shutdownTimeoutMillis: 1234 });
  register.installGracefulShutdown({ shutdownTimeoutMillis: 9999 });

  process.listeners('SIGINT')[0]();
  process.listeners('SIGTERM')[0]();
  process.listeners('beforeExit')[0]();
  await waitForMicrotasks();
  assert.equal(shutdownCalls.length, 3);
  assert.equal(shutdownCalls[0].timeoutMillis, 1234);

  process.exit(3);
  await waitForMicrotasks();
  process.exit(4);
  await waitForMicrotasks();

  assert.deepEqual(exitCalls, [3]);
  assert.equal(shutdownCalls.length, 4);
  assert.equal(shutdownCalls[3].timeoutMillis, 1234);

  register.resetGracefulShutdownForTests();
  process.exit = originalExit;
  tracing.shutdownTracing = originalShutdown;
});

test('bootstrapTracing manual call invokes initTracing and installs shutdown hooks', async () => {
  const tracing = require('../observability/tracing');
  const originalInit = tracing.initTracing;
  const originalShutdown = tracing.shutdownTracing;
  const originalExit = process.exit;

  const events = {
    initCalls: 0,
    shutdownCalls: 0,
    exitCalls: [],
  };

  tracing.initTracing = () => {
    events.initCalls += 1;
  };
  tracing.shutdownTracing = async () => {
    events.shutdownCalls += 1;
  };
  process.exit = (code) => {
    events.exitCalls.push(code);
  };

  const register = loadRegisterModule('1');
  register.bootstrapTracing();
  register.bootstrapTracing();

  assert.equal(events.initCalls, 2);

  process.listeners('SIGINT')[0]();
  await waitForMicrotasks();
  assert.equal(events.shutdownCalls, 1);

  process.exit(0);
  await waitForMicrotasks();
  assert.deepEqual(events.exitCalls, [0]);

  register.resetGracefulShutdownForTests();
  process.exit = originalExit;
  tracing.initTracing = originalInit;
  tracing.shutdownTracing = originalShutdown;
});

test.afterEach(() => {
  const registerModule = require.cache[REGISTER_PATH];
  if (registerModule && registerModule.exports && registerModule.exports.resetGracefulShutdownForTests) {
    registerModule.exports.resetGracefulShutdownForTests();
  }
  delete require.cache[REGISTER_PATH];
  delete require.cache[TRACING_PATH];
  delete process.env.OTEL_BOOTSTRAP_DISABLED;
});
