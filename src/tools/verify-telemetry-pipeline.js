import { config } from '../config.js';
import { connectBroker, publishJson } from '../infra/broker.js';
import { closeDatabase, connectDatabase } from '../infra/mongo.js';

const vehicleId = process.env.VERIFY_VEHICLE_ID ?? 'vehicle-00001';
const timeoutMs = Number(process.env.VERIFY_TIMEOUT_MS ?? 30_000);
const db = await connectDatabase();
const collection = db.collection('vehicles_live');
const previous = await collection.findOne({ _id: vehicleId });

if (!previous?.position?.coordinates) {
  throw new Error(`No existing live record found for ${vehicleId}`);
}

const clientId = process.env.MQTT_CLIENT_ID ?? vehicleId;
const broker = await connectBroker(clientId);
const sentAt = new Date();
const [lon, lat] = previous.position.coordinates;
const reading = {
  vehicleId,
  timestamp: sentAt.toISOString(),
  // Move roughly ten centimetres so the parked-reading filter keeps this
  // verification sample without changing the vehicle's operational status.
  lat: lat + 0.000001,
  lon,
  speedKmh: 0,
  batteryPct: previous.batteryPct ?? 90,
  status: 'idle'
};

try {
  await publishJson(broker, `fleet/vehicles/${vehicleId}/telemetry`, reading);
  console.log(JSON.stringify({ stage: 'mqtt', result: 'published', vehicleId, sentAt }));

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stored = await collection.findOne({ _id: vehicleId });
    if (stored && new Date(stored.timestamp).getTime() >= sentAt.getTime()) {
      console.log(JSON.stringify({
        stage: 'pipeline',
        result: 'verified',
        vehicleId,
        storedAt: stored.timestamp,
        h3Cell: stored.h3Cell,
        status: stored.status
      }));
      process.exitCode = 0;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  if (process.exitCode !== 0) {
    throw new Error(`Telemetry was not stored within ${timeoutMs} ms`);
  }
} finally {
  await new Promise((resolve) => broker.end(false, resolve));
  await closeDatabase();
}
