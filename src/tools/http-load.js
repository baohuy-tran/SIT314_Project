import { performance } from 'node:perf_hooks';

const baseUrl = (process.env.API_BASE_URL ?? '').replace(/\/$/, '');
const requestCount = Number(process.env.LOAD_REQUESTS ?? 200);
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 20);
const timeoutMs = Number(process.env.LOAD_TIMEOUT_MS ?? 5_000);

if (!baseUrl) throw new Error('API_BASE_URL is required');
if (!Number.isInteger(requestCount) || requestCount < 1) throw new Error('LOAD_REQUESTS must be a positive integer');
if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('LOAD_CONCURRENCY must be a positive integer');

const latencies = [];
const statusCounts = new Map();
let nextRequest = 0;
let failures = 0;

function percentile(sorted, value) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(value * sorted.length) - 1)];
}

async function worker() {
  while (true) {
    const index = nextRequest;
    nextRequest += 1;
    if (index >= requestCount) return;

    const started = performance.now();
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json' }
      });
      await response.arrayBuffer();
      statusCounts.set(response.status, (statusCounts.get(response.status) ?? 0) + 1);
      if (!response.ok) failures += 1;
    } catch {
      failures += 1;
      statusCounts.set('network_error', (statusCounts.get('network_error') ?? 0) + 1);
    } finally {
      latencies.push(performance.now() - started);
    }
  }
}

const started = performance.now();
await Promise.all(Array.from({ length: Math.min(concurrency, requestCount) }, worker));
const durationMs = performance.now() - started;
latencies.sort((a, b) => a - b);

const result = {
  target: `${baseUrl}/health`,
  requests: requestCount,
  concurrency,
  successes: requestCount - failures,
  failures,
  successRatePct: Number((((requestCount - failures) / requestCount) * 100).toFixed(2)),
  durationMs: Number(durationMs.toFixed(2)),
  requestsPerSecond: Number((requestCount / (durationMs / 1000)).toFixed(2)),
  latencyMs: {
    min: Number(latencies[0].toFixed(2)),
    p50: Number(percentile(latencies, 0.50).toFixed(2)),
    p95: Number(percentile(latencies, 0.95).toFixed(2)),
    p99: Number(percentile(latencies, 0.99).toFixed(2)),
    max: Number(latencies.at(-1).toFixed(2))
  },
  statusCounts: Object.fromEntries(statusCounts)
};

console.log(JSON.stringify(result, null, 2));
if (failures > 0) process.exitCode = 1;
