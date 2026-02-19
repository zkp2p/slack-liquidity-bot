const tracing = require('./tracing');

let processExitPatched = false;
let originalProcessExit = null;
let signalHandlers = null;

function installGracefulShutdown(options = {}) {
  if (processExitPatched) {
    return;
  }

  const shutdownTimeoutMillis = Number.isFinite(options.shutdownTimeoutMillis)
    ? options.shutdownTimeoutMillis
    : undefined;

  let exiting = false;
  originalProcessExit = process.exit.bind(process);
  signalHandlers = {
    sigint: () => {
      void tracing.shutdownTracing({ timeoutMillis: shutdownTimeoutMillis });
    },
    sigterm: () => {
      void tracing.shutdownTracing({ timeoutMillis: shutdownTimeoutMillis });
    },
    beforeExit: () => {
      void tracing.shutdownTracing({ timeoutMillis: shutdownTimeoutMillis });
    },
  };

  process.exit = (code = 0) => {
    if (exiting) {
      return;
    }
    exiting = true;

    tracing
      .shutdownTracing({ timeoutMillis: shutdownTimeoutMillis })
      .catch(() => undefined)
      .finally(() => {
        originalProcessExit(code);
      });
  };

  process.prependListener('SIGINT', signalHandlers.sigint);
  process.prependListener('SIGTERM', signalHandlers.sigterm);
  process.prependListener('beforeExit', signalHandlers.beforeExit);

  processExitPatched = true;
}

function bootstrapTracing() {
  tracing.initTracing();
  installGracefulShutdown();
}

if (process.env.OTEL_BOOTSTRAP_DISABLED !== '1') {
  bootstrapTracing();
}

function resetGracefulShutdownForTests() {
  if (!processExitPatched) {
    return;
  }

  if (signalHandlers) {
    process.removeListener('SIGINT', signalHandlers.sigint);
    process.removeListener('SIGTERM', signalHandlers.sigterm);
    process.removeListener('beforeExit', signalHandlers.beforeExit);
  }

  if (originalProcessExit) {
    process.exit = originalProcessExit;
  }

  signalHandlers = null;
  originalProcessExit = null;
  processExitPatched = false;
}

module.exports = {
  bootstrapTracing,
  installGracefulShutdown,
  resetGracefulShutdownForTests,
};
