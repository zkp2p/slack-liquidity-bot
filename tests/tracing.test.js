const assert = require('node:assert/strict');
const test = require('node:test');
const { diag, DiagLogLevel } = require('@opentelemetry/api');

const tracing = require('../observability/tracing');

function createFakeDependencies() {
  const calls = {
    autoInstrumentationConfig: null,
    sdkInstances: [],
    setupDiagLogger: [],
  };

  class FakeOTLPTraceExporter {
    constructor(options) {
      this.options = options;
      calls.exporterOptions = options;
    }
  }

  class FakeBatchSpanProcessor {
    constructor(exporter, options) {
      this.exporter = exporter;
      this.options = options;
      calls.batchSpanProcessor = options;
    }
  }

  class FakeParentBasedSampler {
    constructor(options) {
      this.options = options;
      calls.parentSampler = options;
    }
  }

  class FakeTraceIdRatioBasedSampler {
    constructor(ratio) {
      this.ratio = ratio;
      calls.traceIdRatio = ratio;
    }
  }

  class FakeAsyncLocalStorageContextManager {}

  class FakeNodeSDK {
    constructor(options) {
      this.options = options;
      this.startCount = 0;
      this.shutdownCount = 0;
      calls.sdkInstances.push(this);
    }

    start() {
      this.startCount += 1;
    }

    shutdown() {
      this.shutdownCount += 1;
      return Promise.resolve();
    }
  }

  return {
    calls,
    dependencies: {
      NodeSDK: FakeNodeSDK,
      BatchSpanProcessor: FakeBatchSpanProcessor,
      ParentBasedSampler: FakeParentBasedSampler,
      TraceIdRatioBasedSampler: FakeTraceIdRatioBasedSampler,
      OTLPTraceExporter: FakeOTLPTraceExporter,
      getNodeAutoInstrumentations(config) {
        calls.autoInstrumentationConfig = config;
        return { config };
      },
      AsyncLocalStorageContextManager: FakeAsyncLocalStorageContextManager,
      resourceFromAttributes(attributes) {
        calls.resourceAttributes = attributes;
        return { attributes };
      },
      setupDiagLogger(config) {
        calls.setupDiagLogger.push(config.diagLogLevel || '');
      },
    },
  };
}

test('parse helpers handle valid and invalid inputs', () => {
  assert.equal(tracing.parseBoolean('true', false), true);
  assert.equal(tracing.parseBoolean('YES', false), true);
  assert.equal(tracing.parseBoolean('0', true), false);
  assert.equal(tracing.parseBoolean('invalid', true), true);

  assert.equal(tracing.parseInteger('12', 4, 1), 12);
  assert.equal(tracing.parseInteger('abc', 4, 1), 4);
  assert.equal(tracing.parseInteger('0', 4, 1), 4);

  assert.equal(tracing.parseSampleRatio('0.25', 0.9), 0.25);
  assert.equal(tracing.parseSampleRatio('1.4', 0.9), 0.9);
  assert.equal(tracing.parseSampleRatio('bad', 0.9), 0.9);

  assert.deepEqual(tracing.parseHeaderList('authorization=Bearer abc, x-source-token=xyz'), {
    authorization: 'Bearer abc',
    'x-source-token': 'xyz',
  });
  assert.deepEqual(tracing.parseHeaderList('bad-entry, k=v, empty='), { k: 'v' });
  assert.deepEqual(tracing.parseHeaderList(''), {});
});

test('endpoint normalization appends /v1/traces as needed', () => {
  assert.equal(tracing.normalizeOtlpTracesEndpoint('https://example.com'), 'https://example.com/v1/traces');
  assert.equal(
    tracing.normalizeOtlpTracesEndpoint('https://example.com/custom/path/'),
    'https://example.com/custom/path/v1/traces'
  );
  assert.equal(
    tracing.normalizeOtlpTracesEndpoint('https://example.com/v1/traces'),
    'https://example.com/v1/traces'
  );
  assert.equal(tracing.normalizeOtlpTracesEndpoint('  '), '');
});

test('buildTracingConfig composes endpoint, headers, and batching defaults', () => {
  const config = tracing.buildTracingConfig({
    OTEL_TRACING_ENABLED: 'true',
    SERVICE_NAME: 'svc-a',
    NODE_ENV: 'production',
    BETTERSTACK_SOURCE_TOKEN: 'token-123',
    BETTERSTACK_ENDPOINT: 'https://otel.example.com',
    OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer old,x-team=infra',
    OTEL_TRACES_SAMPLE_RATIO: '0.4',
    OTEL_BSP_MAX_QUEUE_SIZE: '1000',
    OTEL_BSP_MAX_EXPORT_BATCH_SIZE: '2000',
    OTEL_BSP_SCHEDULE_DELAY: '3000',
    OTEL_BSP_EXPORT_TIMEOUT: '7000',
    OTEL_SHUTDOWN_TIMEOUT: '9000',
    OTEL_DIAGNOSTIC_LOG_LEVEL: 'warn',
  });

  assert.equal(config.enabled, true);
  assert.equal(config.serviceName, 'svc-a');
  assert.equal(config.deploymentEnvironment, 'production');
  assert.equal(config.endpoint, 'https://otel.example.com/v1/traces');
  assert.equal(config.headers.authorization, 'Bearer old');
  assert.equal(config.headers['x-source-token'], 'token-123');
  assert.equal(config.headers['x-team'], 'infra');
  assert.equal(config.sampleRatio, 0.4);
  assert.equal(config.maxQueueSize, 1000);
  assert.equal(config.maxExportBatchSize, 1000);
  assert.equal(config.scheduledDelayMillis, 3000);
  assert.equal(config.exportTimeoutMillis, 7000);
  assert.equal(config.shutdownTimeoutMillis, 9000);
  assert.equal(config.diagLogLevel, 'WARN');
});

test('buildTracingConfig falls back cleanly when tracing endpoint is absent', () => {
  const config = tracing.buildTracingConfig({
    OTEL_TRACING_ENABLED: 'false',
    OTEL_TRACES_SAMPLE_RATIO: 'bad',
  });

  assert.equal(config.enabled, false);
  assert.equal(config.endpoint, '');
  assert.equal(config.sampleRatio, 0.1);
  assert.deepEqual(config.headers, {});
});

test('buildTracingConfig adds authorization header when token exists and auth header is missing', () => {
  const config = tracing.buildTracingConfig({
    BETTERSTACK_SOURCE_TOKEN: 'source-token',
  });

  assert.equal(config.headers.authorization, 'Bearer source-token');
  assert.equal(config.headers['x-source-token'], 'source-token');
  assert.equal(config.endpoint, 'https://in.logs.betterstack.com/v1/traces');
});

test('toDiagLogLevel maps all supported values', () => {
  assert.equal(tracing.toDiagLogLevel('ALL'), DiagLogLevel.ALL);
  assert.equal(tracing.toDiagLogLevel('DEBUG'), DiagLogLevel.DEBUG);
  assert.equal(tracing.toDiagLogLevel('VERBOSE'), DiagLogLevel.DEBUG);
  assert.equal(tracing.toDiagLogLevel('INFO'), DiagLogLevel.INFO);
  assert.equal(tracing.toDiagLogLevel('WARN'), DiagLogLevel.WARN);
  assert.equal(tracing.toDiagLogLevel('ERROR'), DiagLogLevel.ERROR);
  assert.equal(tracing.toDiagLogLevel('NONE'), DiagLogLevel.NONE);
  assert.equal(tracing.toDiagLogLevel('NOPE'), null);
  assert.equal(tracing.toDiagLogLevel(''), null);
});

test('setupDiagLogger only configures diag when level is valid', () => {
  const originalSetLogger = diag.setLogger;
  const calls = [];

  diag.setLogger = (_logger, level) => {
    calls.push(level);
  };

  tracing.setupDiagLogger({ diagLogLevel: 'WARN' });
  tracing.setupDiagLogger({ diagLogLevel: 'not-real' });

  diag.setLogger = originalSetLogger;

  assert.deepEqual(calls, [DiagLogLevel.WARN]);
});

test('createTracingManager initializes sdk, instrumentations and sampler once', async () => {
  const { dependencies, calls } = createFakeDependencies();
  const manager = tracing.createTracingManager(dependencies);

  const result = manager.initTracing({
    enabled: true,
    endpoint: 'https://collector.example.com/v1/traces',
    headers: { authorization: 'Bearer abc' },
    serviceName: 'api-service',
    serviceVersion: '2.0.0',
    deploymentEnvironment: 'prod',
    sampleRatio: 0.5,
    maxQueueSize: 512,
    maxExportBatchSize: 128,
    scheduledDelayMillis: 4000,
    exportTimeoutMillis: 10000,
    shutdownTimeoutMillis: 3000,
    diagLogLevel: 'INFO',
  });

  assert.equal(result.enabled, true);
  assert.equal(calls.setupDiagLogger.length, 1);
  assert.equal(calls.sdkInstances.length, 1);
  assert.equal(calls.sdkInstances[0].startCount, 1);
  assert.equal(calls.traceIdRatio, 0.5);
  assert.equal(calls.batchSpanProcessor.maxQueueSize, 512);
  assert.equal(calls.batchSpanProcessor.maxExportBatchSize, 128);
  assert.equal(calls.exporterOptions.url, 'https://collector.example.com/v1/traces');
  assert.equal(calls.exporterOptions.headers.authorization, 'Bearer abc');
  assert.equal(calls.resourceAttributes['service.name'], 'api-service');
  assert.equal(calls.resourceAttributes['deployment.environment'], 'prod');
  assert.equal(
    calls.autoInstrumentationConfig['@opentelemetry/instrumentation-pino'].disableLogSending,
    true
  );
  assert.equal(
    calls.autoInstrumentationConfig['@opentelemetry/instrumentation-pino'].logKeys.traceId,
    'trace_id'
  );
  assert.equal(calls.autoInstrumentationConfig['@opentelemetry/instrumentation-nestjs-core'], undefined);
  assert.equal(calls.autoInstrumentationConfig['@opentelemetry/instrumentation-pg'], undefined);
  assert.equal(calls.autoInstrumentationConfig['@opentelemetry/instrumentation-redis'], undefined);

  const secondResult = manager.initTracing();
  assert.equal(secondResult.enabled, true);
  assert.equal(calls.sdkInstances.length, 1);

  const runtime = manager.getRuntimeState();
  assert.equal(runtime.initialized, true);
  assert.ok(runtime.spanProcessor);
  assert.ok(runtime.resource);

  await manager.shutdownTracing();
  assert.equal(calls.sdkInstances[0].shutdownCount, 1);
  assert.equal(manager.getRuntimeState().initialized, false);
});

test('createTracingManager no-ops when disabled or endpoint missing', () => {
  const { dependencies, calls } = createFakeDependencies();
  const managerA = tracing.createTracingManager(dependencies);
  const disabledResult = managerA.initTracing({ enabled: false, endpoint: 'https://x/v1/traces' });
  assert.equal(disabledResult.enabled, false);
  assert.equal(calls.sdkInstances.length, 0);

  const managerB = tracing.createTracingManager(dependencies);
  const noEndpointResult = managerB.initTracing({ enabled: true, endpoint: '' });
  assert.equal(noEndpointResult.enabled, false);
  assert.equal(calls.sdkInstances.length, 0);
});

test('shutdownTracing tolerates timeout and uninitialized states', async () => {
  const { dependencies, calls } = createFakeDependencies();

  class NeverEndingNodeSDK extends dependencies.NodeSDK {
    shutdown() {
      this.shutdownCount += 1;
      return new Promise(() => {});
    }
  }

  const manager = tracing.createTracingManager({
    ...dependencies,
    NodeSDK: NeverEndingNodeSDK,
  });

  await manager.shutdownTracing();

  manager.initTracing({
    enabled: true,
    endpoint: 'https://collector.example.com/v1/traces',
    shutdownTimeoutMillis: 5,
  });

  await manager.shutdownTracing({ timeoutMillis: 1 });
  assert.equal(calls.sdkInstances[0].shutdownCount, 1);
  assert.equal(manager.getRuntimeState().initialized, false);
});

test('shutdownTracing returns the in-flight shutdown promise when called concurrently', async () => {
  const { dependencies, calls } = createFakeDependencies();

  let releaseShutdown;
  class SlowShutdownNodeSDK extends dependencies.NodeSDK {
    shutdown() {
      this.shutdownCount += 1;
      return new Promise((resolve) => {
        releaseShutdown = resolve;
      });
    }
  }

  const manager = tracing.createTracingManager({
    ...dependencies,
    NodeSDK: SlowShutdownNodeSDK,
  });
  manager.initTracing({
    enabled: true,
    endpoint: 'https://collector.example.com/v1/traces',
  });

  const first = manager.shutdownTracing({ timeoutMillis: 1000 });
  const second = manager.shutdownTracing({ timeoutMillis: 1000 });
  assert.equal(calls.sdkInstances[0].shutdownCount, 1);

  releaseShutdown();
  await Promise.all([first, second]);
});
