import { config, topics } from '../config.js';
import { haversineKm } from '../domain/geo.js';
import { buildTripCompletionEvent } from '../domain/trip.js';
import { connectBroker, publishJson, subscribe } from '../infra/broker.js';
import { logger } from '../infra/logger.js';

const vehicleCount = Number(process.env.VEHICLE_COUNT ?? process.argv[2] ?? 10);
const tickMs = Number(process.env.TICK_MS ?? 1000);
const centre = { lat: -37.8136, lon: 144.9631 };
const randomPoint = (radius = 0.04) => ({
  lat: centre.lat + (Math.random() - 0.5) * radius,
  lon: centre.lon + (Math.random() - 0.5) * radius
});

function moveTowards(position, target, kmPerTick) {
  const distance = haversineKm(position, target);
  if (distance <= kmPerTick) return { ...target, arrived: true };
  const ratio = kmPerTick / distance;
  return {
    lat: position.lat + (target.lat - position.lat) * ratio,
    lon: position.lon + (target.lon - position.lon) * ratio,
    arrived: false
  };
}

// AWS IoT policies commonly require the MQTT client ID to equal the Thing
// name. Local runs retain a unique process-based ID unless explicitly set.
const clientId = process.env.MQTT_CLIENT_ID ?? `vehicle-simulator-${process.pid}`;
const broker = await connectBroker(clientId);
logger.info({ clientId, tls: config.mqttUrl.startsWith('mqtts:') }, 'MQTT broker connected');
const vehicles = new Map(Array.from({ length: vehicleCount }, (_, index) => {
  const vehicleId = `vehicle-${String(index + 1).padStart(5, '0')}`;
  return [vehicleId, {
    vehicleId,
    position: randomPoint(),
    speedKmh: 0,
    batteryPct: 80 + Math.random() * 20,
    status: 'idle',
    trip: null
  }];
}));

await Promise.all(
  [...vehicles.keys()].map((vehicleId) => subscribe(broker, topics.dispatchFor(vehicleId)))
);
broker.on('message', (_topic, payload) => {
  try {
    const command = JSON.parse(payload.toString());
    const vehicleId = _topic.split('/')[2];
    const vehicle = vehicles.get(vehicleId);
    if (!vehicle || command.type !== 'dispatch' || vehicle.status !== 'idle') return;
    vehicle.status = 'to_pickup';
    vehicle.trip = { ...command, startedAt: Date.now(), drivenKm: 0 };
  } catch (error) {
    logger.error({ error }, 'bad command');
  }
});

async function tick() {
  let published = 0;
  for (const vehicle of vehicles.values()) {
    if (vehicle.trip) {
      const target = vehicle.status === 'to_pickup' ? vehicle.trip.pickup : vehicle.trip.dropoff;
      const before = { ...vehicle.position };
      const movement = moveTowards(vehicle.position, target, 0.015);
      vehicle.position = { lat: movement.lat, lon: movement.lon };
      vehicle.speedKmh = movement.arrived ? 0 : 54;
      vehicle.batteryPct = Math.max(0, vehicle.batteryPct - 0.002);
      vehicle.trip.drivenKm += haversineKm(before, vehicle.position);
      if (movement.arrived && vehicle.status === 'to_pickup') vehicle.status = 'occupied';
      else if (movement.arrived && vehicle.status === 'occupied') {
        const event = buildTripCompletionEvent(vehicle);
        await publishJson(broker, topics.tripCompleted, event);
        logger.info({ vehicleId: vehicle.vehicleId, requestId: event.requestId, tripId: event.tripId }, 'trip completion published');
        vehicle.status = 'idle';
        vehicle.trip = null;
      }
    }
    await publishJson(broker, `fleet/vehicles/${vehicle.vehicleId}/telemetry`, {
      vehicleId: vehicle.vehicleId,
      timestamp: new Date().toISOString(),
      lat: vehicle.position.lat,
      lon: vehicle.position.lon,
      speedKmh: vehicle.speedKmh,
      batteryPct: vehicle.batteryPct,
      status: vehicle.status
    });
    published += 1;
  }
  completedTicks += 1;
  if (completedTicks === 1 || completedTicks % 10 === 0) {
    logger.info({ published, vehicleCount }, 'telemetry published');
  }
}

let completedTicks = 0;
let ticking = false;
setInterval(() => {
  if (ticking) return;
  ticking = true;
  tick()
    .catch((error) => logger.error({ error }, 'tick failed'))
    .finally(() => { ticking = false; });
}, tickMs);
logger.info({ vehicleCount, tickMs }, 'vehicle simulator ready');
