import process from 'node:process';

function number(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

export const config = Object.freeze({
  mongoUri: process.env.MONGO_URI ?? 'mongodb://localhost:27017',
  mongoDb: process.env.MONGO_DB ?? 'ride_matching',
  mqttUrl: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
  mqttCaPath: process.env.MQTT_CA_PATH,
  mqttCertPath: process.env.MQTT_CERT_PATH,
  mqttKeyPath: process.env.MQTT_KEY_PATH,
  awsRegion: process.env.AWS_REGION ?? 'us-east-1',
  telemetryTransport: process.env.TELEMETRY_TRANSPORT ?? 'mqtt',
  telemetryQueueUrl: process.env.TELEMETRY_QUEUE_URL,
  rideRequestTransport: process.env.RIDE_REQUEST_TRANSPORT ?? 'mqtt',
  matchingTransport: process.env.MATCHING_TRANSPORT ?? 'mqtt',
  rideQueueUrl: process.env.RIDE_QUEUE_URL,
  dispatchTransport: process.env.DISPATCH_TRANSPORT ?? 'mqtt',
  tripTransport: process.env.TRIP_TRANSPORT ?? 'mqtt',
  tripQueueUrl: process.env.TRIP_QUEUE_URL,
  iotDataEndpoint: process.env.IOT_DATA_ENDPOINT,
  apiAuthToken: process.env.API_AUTH_TOKEN,
  port: number('PORT', 3000),
  batchWindowMs: number('BATCH_WINDOW_MS', 2000),
  maxMatchDistanceKm: number('MAX_MATCH_DISTANCE_KM', 8),
  etaAverageSpeedKmh: number('ETA_AVERAGE_SPEED_KMH', 30),
  h3Resolution: number('H3_RESOLUTION', 8),
  maxVehicleSpeedKmh: number('MAX_VEHICLE_SPEED_KMH', 130)
});

export const topics = Object.freeze({
  telemetry: 'fleet/vehicles/+/telemetry',
  rideRequested: 'fleet/events/ride-requested',
  tripCompleted: 'fleet/events/trip-completed',
  dispatchFor: (vehicleId) => `fleet/vehicles/${vehicleId}/commands`
});
