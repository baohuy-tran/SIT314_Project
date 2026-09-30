import { performance } from 'node:perf_hooks';
import { config } from '../config.js';
import { connectBroker, publishJson } from '../infra/broker.js';

const messageCount = Number(process.env.TELEMETRY_MESSAGES ?? 100);
const intervalMs = Number(process.env.TELEMETRY_INTERVAL_MS ?? 20);
const vehicleId = process.env.MQTT_CLIENT_ID ?? 'vehicle-00001';
const topic = `fleet/vehicles/${vehicleId}/telemetry`;

if (!Number.isInteger(messageCount) || messageCount < 1) {
  throw new Error('TELEMETRY_MESSAGES must be a positive integer');
}
if (!Number.isFinite(intervalMs) || intervalMs < 0) {
  throw new Error('TELEMETRY_INTERVAL_MS must be zero or greater');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const broker = await connectBroker(vehicleId);
const startedAt = new Date();
const started = performance.now();
let lastTimestampMs = startedAt.getTime();

for (let index = 0; index < messageCount; index += 1) {
  const now = Date.now();
  lastTimestampMs = Math.max(now, lastTimestampMs + 1);
  await publishJson(broker, topic, {
    vehicleId,
    timestamp: new Date(lastTimestampMs).toISOString(),
    lat: -37.8136,
    lon: 144.9631,
    speedKmh: 1,
    batteryPct: 90,
    status: 'occupied'
  });
  if (intervalMs > 0 && index + 1 < messageCount) await sleep(intervalMs);
}

const durationMs = performance.now() - started;
await new Promise((resolve) => broker.end(false, {}, resolve));

console.log(JSON.stringify({
  endpoint: config.mqttUrl,
  vehicleId,
  topic,
  messages: messageCount,
  intervalMs,
  durationMs: Number(durationMs.toFixed(2)),
  publishRatePerSecond: Number((messageCount / (durationMs / 1000)).toFixed(2)),
  startedAt: startedAt.toISOString(),
  finalTimestamp: new Date(lastTimestampMs).toISOString()
}, null, 2));
