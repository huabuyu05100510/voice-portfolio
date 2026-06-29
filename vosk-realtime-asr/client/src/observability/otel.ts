/**
 * Web OpenTelemetry 初始化 (Module B)
 *
 * - WebTracerProvider + auto-instrumentations
 * - 默认 DEV 环境开启, 生产关闭 (降低 bundle 影响)
 * - TraceToggle UI 可运行时切换
 * - 跨进程通过 Socket.IO auth.traceparent 透传 W3C trace context
 */
import {
  WebTracerProvider,
  BatchSpanProcessor,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getWebAutoInstrumentations } from '@opentelemetry/auto-instrumentations-web';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions';

import { setupGlobalErrorHandlers } from './errors';

let provider: WebTracerProvider | null = null;
let enabled = false;
/** 用户是否显式调用过 setObservabilityEnabled. 显式 false 覆盖 env DEV 默认值. */
let explicitlySet = false;

// 模块级 logger — 不依赖 console (确保结构化)
function log(level: string, msg: string, meta?: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : 'log'](
    JSON.stringify({ level, msg, module: 'otel', ...meta }),
  );
}

export interface InitOptions {
  enabled?: boolean;
  /** OTLP 端点 URL (默认 /otel/v1/traces, 走 vite proxy) */
  endpoint?: string;
  /** 强制用 console exporter (本地开发排查用, 不依赖 Jaeger) */
  useConsoleExporter?: boolean;
}

/**
 * 初始化 Web OTel SDK. 重复调用幂等.
 *
 * - dev 默认 enabled=true (Vite import.meta.env.DEV)
 * - prod 默认 enabled=false (避免 bundle 噪声)
 * - 测试可通过 setObservabilityEnabled(true) + initObservability() 强制开启
 */
export function initObservability(opts: InitOptions = {}): void {
  if (provider) {
    log('info', 'observability already initialized, no-op');
    return;
  }

  const envEnabled =
    typeof import.meta !== 'undefined' &&
    (import.meta as any).env &&
    (import.meta as any).env.DEV === true;
  // 优先级: opts.enabled > explicitlySet (setObservabilityEnabled) > env.DEV
  if (opts.enabled !== undefined) {
    enabled = opts.enabled;
    explicitlySet = true;
  } else if (explicitlySet) {
    // 保留之前 setObservabilityEnabled 设置的值
  } else {
    enabled = envEnabled;
  }
  if (!enabled) {
    log('info', 'observability disabled by config', { envEnabled, explicitlySet });
    return;
  }

  const endpoint =
    opts.endpoint ?? '/otel/v1/traces';
  const exporter = opts.useConsoleExporter
    ? new ConsoleSpanExporter()
    : new OTLPTraceExporter({ url: endpoint });

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'voice-portfolio-client',
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]:
      (typeof import.meta !== 'undefined' &&
        (import.meta as any).env?.MODE) ||
      'development',
  });

  provider = new WebTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(exporter, {
        maxQueueSize: 100,
        maxExportBatchSize: 20,
      }),
    ],
  });

  provider.register();

  // v2 SDK: instrumentations 通过 setTracerProvider + enable 手动注册
  // (v1 的 register({ instrumentations }) 在 v2 已移除)
  const instrumentations = getWebAutoInstrumentations({
    '@opentelemetry/instrumentation-document-load': {},
    '@opentelemetry/instrumentation-user-interaction': {},
    '@opentelemetry/instrumentation-fetch': {},
    '@opentelemetry/instrumentation-xml-http-request': {},
  });
  for (const inst of instrumentations) {
    try {
      inst.setTracerProvider(provider);
      inst.enable();
    } catch (e) {
      log('warn', 'instrumentation enable failed', {
        name: (inst as any).instrumentationName,
        error: String((e as Error)?.message),
      });
    }
  }

  setupGlobalErrorHandlers();

  log('info', 'observability initialized', { endpoint });
}

/**
 * 运行时切换 enabled 标志. 已初始化的 provider 不再关闭 (避免丢 span).
 */
export function setObservabilityEnabled(v: boolean): void {
  enabled = v;
  explicitlySet = true;
  if (v && !provider) {
    initObservability({ enabled: true });
  }
}

export function isObservabilityEnabled(): boolean {
  return enabled;
}

/** 测试用: 拿当前 provider, 不存在则 null */
export function getObservabilityProvider(): WebTracerProvider | null {
  return provider;
}

/** 测试用 / 卸载时: 关闭 provider 并清空状态 */
export async function shutdownObservability(): Promise<void> {
  if (provider) {
    try {
      await provider.shutdown();
    } catch {
      // ignore
    }
    provider = null;
    enabled = false;
    explicitlySet = false;
  }
}
