import { config, topics } from '../config.js';
import { connectBroker, publishJson } from '../infra/broker.js';

const count = Number(process.argv[2] ?? 20);
const clusterRadius = Number(process.env.CLUSTER_RADIUS ?? 0.015);
const centre = { lat: -37.8136, lon: 144.9631 };
const broker = await connectBroker(`ride-generator-${process.pid}`);
const randomPoint = (radius) => ({
  lat: centre.lat + (Math.random() - 0.5) * radius,
  lon: centre.lon + (Math.random() - 0.5) * radius
});

for (let index = 0; index < count; index += 1) {
  await publishJson(broker, topics.rideRequested, {
    requestId: `generated-${Date.now()}-${index}`,
    requestedAt: new Date().toISOString(),
    pickup: randomPoint(clusterRadius),
    dropoff: randomPoint(0.08)
  });
}
broker.end();
console.log(`Published ${count} clustered ride requests to ${config.mqttUrl}`);

