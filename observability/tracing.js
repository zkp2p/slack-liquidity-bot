const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { AsyncLocalStorageContextManager } = require('@opentelemetry/context-async-hooks');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} = require('@opentelemetry/sdk-trace-base');

const DEFAULT_BETTERSTACK_OTLP_TRACES_ENDPOINT = 'https://in-otel.logs.betterstack.com/v1/traces';

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return fallback;
}

function parseInteger(value, fallback, min) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (typeof min === 'number' && parsed < min) {
    return fallback;
  }
  return parsed;
}

function parseSampleRatio(value, fallback = 0.1) {
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < 0 || parsed > 1) {
    return fallback;
  }
  return parsed;
}

function parseHeaderList(raw) {
  if (!raw || typeof raw !== 'string') {
    return {};
  }

  const headers = {};
  const pairs = raw.split(',');
  for (const pair of pairs) {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (!key || !value) {
      continue;
    }

    headers[key.toLowerCase()] = value;
  }
  return headers;
}

function normalizeOtlpTracesEndpoint(rawEndpoint) {
  const endpoint = String(rawEndpoint || '').trim();
  if (!endpoint) {
    return '';
  }

  if (endpoint.endsWith('/v1/traces')) {
    return endpoint;
  }
  return `${endpoint.replace(/\/+$/, '')}/v1/traces`;
}

function buildTracingConfig(env = process.env) {
  const enabled = parseBoolean(env.OTEL_TRACING_ENABLED, true);
  const serviceName = env.OTEL_SERVICE_NAME || env.SERVICE_NAME || 'slack-liquidity-bot';
  const serviceVersion = env.OTEL_SERVICE_VERSION || env.npm_package_version || '1.0.0';
  const deploymentEnvironment = env.OTEL_DEPLOYMENT_ENVIRONMENT || env.NODE_ENV || 'development';
  const sampleRatio = parseSampleRatio(env.OTEL_TRACES_SAMPLE_RATIO, 0.1);

  const maxQueueSize = parseInteger(env.OTEL_BSP_MAX_QUEUE_SIZE, 2048, 1);
  const exportBatchSize = parseInteger(env.OTEL_BSP_MAX_EXPORT_BATCH_SIZE, 512, 1);
  const maxExportBatchSize = Math.min(exportBatchSize, maxQueueSize);
  const scheduledDelayMillis = parseInteger(env.OTEL_BSP_SCHEDULE_DELAY, 5000, 1);
  const exportTimeoutMillis = parseInteger(env.OTEL_BSP_EXPORT_TIMEOUT, 30000, 1);
  const shutdownTimeoutMillis = parseInteger(env.OTEL_SHUTDOWN_TIMEOUT, 5000, 1);

  const token = env.BETTERSTACK_OTLP_TOKEN || env.BETTERSTACK_SOURCE_TOKEN || '';
  const configuredEndpoint =
    env.BETTERSTACK_OTLP_TRACES_ENDPOINT ||
    env.BETTERSTACK_OTLP_ENDPOINT ||
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    (token ? DEFAULT_BETTERSTACK_OTLP_TRACES_ENDPOINT : '');
  const endpoint = normalizeOtlpTracesEndpoint(configuredEndpoint);

  const headers = {
    ...parseHeaderList(env.OTEL_EXPORTER_OTLP_HEADERS),
    ...parseHeaderList(env.BETTERSTACK_OTLP_HEADERS),
  };

  if (token) {
    if (!headers.authorization) {
      headers.authorization = `Bearer ${token}`;
    }
    if (!headers['x-source-token']) {
      headers['x-source-token'] = token;
    }
  }

  const diagLogLevel = (env.OTEL_DIAGNOSTIC_LOG_LEVEL || '').trim().toUpperCase();

  return {
    enabled,
    endpoint,
    headers,
    serviceName,
    serviceVersion,
    deploymentEnvironment,
    sampleRatio,
    maxQueueSize,
    maxExportBatchSize,
    scheduledDelayMillis,
    exportTimeoutMillis,
    shutdownTimeoutMillis,
    diagLogLevel,
  };
}

function toDiagLogLevel(value) {
  if (!value) {
    return null;
  }
  switch (value) {
    case 'ALL':
      return DiagLogLevel.ALL;
    case 'VERBOSE':
    case 'DEBUG':
      return DiagLogLevel.DEBUG;
    case 'INFO':
      return DiagLogLevel.INFO;
    case 'WARN':
      return DiagLogLevel.WARN;
    case 'ERROR':
      return DiagLogLevel.ERROR;
    case 'NONE':
      return DiagLogLevel.NONE;
    default:
      return null;
  }
}

function setupDiagLogger(config) {
  const level = toDiagLogLevel(config.diagLogLevel);
  if (level === null) {
    return;
  }
  diag.setLogger(new DiagConsoleLogger(), level);
}

function createTracingManager(dependencies = {}) {
  const deps = {
    NodeSDK,
    BatchSpanProcessor,
    ParentBasedSampler,
    TraceIdRatioBasedSampler,
    OTLPTraceExporter,
    getNodeAutoInstrumentations,
    AsyncLocalStorageContextManager,
    resourceFromAttributes,
    setupDiagLogger,
    ...dependencies,
  };

  let sdk = null;
  let config = null;
  let initialized = false;
  let shutdownPromise = null;
  let spanProcessor = null;
  let resource = null;

  function initTracing(overrides = {}) {
    if (initialized) {
      return { enabled: true, config };
    }

    config = { ...buildTracingConfig(), ...overrides };
    deps.setupDiagLogger(config);

    if (!config.enabled || !config.endpoint) {
      return { enabled: false, config };
    }

    const traceExporter = new deps.OTLPTraceExporter({
      url: config.endpoint,
      headers: config.headers,
      timeoutMillis: config.exportTimeoutMillis,
    });

    spanProcessor = new deps.BatchSpanProcessor(traceExporter, {
      maxQueueSize: config.maxQueueSize,
      maxExportBatchSize: config.maxExportBatchSize,
      scheduledDelayMillis: config.scheduledDelayMillis,
      exportTimeoutMillis: config.exportTimeoutMillis,
    });

    resource = deps.resourceFromAttributes({
      'service.name': config.serviceName,
      'service.version': config.serviceVersion,
      'deployment.environment': config.deploymentEnvironment,
    });

    sdk = new deps.NodeSDK({
      resource,
      contextManager: new deps.AsyncLocalStorageContextManager(),
      sampler: new deps.ParentBasedSampler({
        root: new deps.TraceIdRatioBasedSampler(config.sampleRatio),
      }),
      spanProcessors: [spanProcessor],
      instrumentations: [
        deps.getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-http': { enabled: true },
          '@opentelemetry/instrumentation-express': { enabled: true },
          '@opentelemetry/instrumentation-undici': { enabled: true },
          '@opentelemetry/instrumentation-pino': {
            enabled: true,
            disableLogSending: true,
            disableLogCorrelation: false,
            logKeys: {
              traceId: 'trace_id',
              spanId: 'span_id',
              traceFlags: 'trace_flags',
            },
          },
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    });

    sdk.start();
    initialized = true;

    return { enabled: true, config };
  }

  async function shutdownTracing(options = {}) {
    if (!initialized || !sdk) {
      return;
    }
    if (shutdownPromise) {
      return shutdownPromise;
    }

    const timeoutMillis = parseInteger(options.timeoutMillis, config.shutdownTimeoutMillis, 1);
    const localSdk = sdk;

    const timeoutPromise = new Promise((resolve) => {
      setTimeout(resolve, timeoutMillis);
    });

    shutdownPromise = Promise.race([localSdk.shutdown(), timeoutPromise]).finally(() => {
      initialized = false;
      sdk = null;
      spanProcessor = null;
      resource = null;
      shutdownPromise = null;
    });

    return shutdownPromise;
  }

  function getRuntimeState() {
    return {
      initialized,
      config,
      spanProcessor,
      resource,
    };
  }

  return {
    initTracing,
    shutdownTracing,
    getRuntimeState,
  };
}

const manager = createTracingManager();

module.exports = {
  initTracing: manager.initTracing,
  shutdownTracing: manager.shutdownTracing,
  getTracingRuntimeState: manager.getRuntimeState,
  createTracingManager,
  buildTracingConfig,
  normalizeOtlpTracesEndpoint,
  parseBoolean,
  parseHeaderList,
  parseInteger,
  parseSampleRatio,
  setupDiagLogger,
  toDiagLogLevel,
};
