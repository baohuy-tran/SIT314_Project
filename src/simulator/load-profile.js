import { performance } from 'node:perf_hooks';
import { config } from '../config.js';
import { connectBroker, publishJson } from '../infra/broker.js';

const baseline = Number(process.env.BASELINE_VEHICLES ?? 500);
const peak = Number(process.env.PEAK_VEHICLES ?? 5000);
const steps = Number(process.env.RAMP_STEPS ?? 10);
const intervalMs = Number(process.env.RAMP_INTERVAL_MS ?? 1000);
const centre = { lat: -37.8136, lon: 144.9631 };
const broker = await connectBroker(`load-profile-${process.pid}`);
const active = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pointFor = (index) => ({
  lat: centre.lat + ((index % 100) - 50) * 0.0002,
  lon: centre.lon + ((Math.floor(index / 100) % 100) - 50) * 0.0002
});

async function publishFleet(size) {
  const started = performance.now();
  for (let index = 0; index < size; index += 1) {
    const vehicleId = `load-${String(index).padStart(5, '0')}`;
    const position = pointFor(index);
    active.set(vehicleId, position);
    await publishJson(broker, `fleet/vehicles/${vehicleId}/telemetry`, {
      vehicleId,
      timestamp: new Date().toISOString(),
      ...position,
      speedKmh: 0,
      batteryPct: 80,
      status: 'idle'
    });
  }
  console.log(JSON.stringify({ fleetSize: size, publishMs: Math.round(performance.now() - started) }));
}

for (let step = 0; step <= steps; step += 1) {
  await publishFleet(Math.round(baseline + ((peak - baseline) * step) / steps));
  await sleep(intervalMs);
}
for (let step = steps - 1; step >= 0; step -= 1) {
  await publishFleet(Math.round(baseline + ((peak - baseline) * step) / steps));
  await sleep(intervalMs);
}
broker.end();
console.log(`Load profile complete against ${config.mqttUrl}`);
