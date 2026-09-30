import { config, topics } from '../config.js';
import { enrichTelemetry, isRedundantParkedReading, parseTelemetry, validateMovement } from '../domain/telemetry.js';
import { connectBroker, subscribe } from '../infra/broker.js';
import { FleetRepository, connectDatabase } from '../infra/mongo.js';
import { logger } from '../infra/logger.js';
import { consumeQueue, createSqsClient } from '../infra/sqs-consumer.js';

const db = await connectDatabase();
const repository = new FleetRepository(db);

async function processPayload(payload) {
  const reading = parseTelemetry(JSON.parse(payload.toString()));
  const previousDoc = await repository.getVehicle(reading.vehicleId);
  const previous = previousDoc ? {
    timestamp: previousDoc.timestamp,
    lat: previousDoc.position.coordinates[1],
    lon: previousDoc.position.coordinates[0],
    speedKmh: previousDoc.speedKmh,
    status: previousDoc.status
  } : undefined;
  const movement = validateMovement(reading, previous, { maxSpeedKmh: config.maxVehicleSpeedKmh });
  if (!movement.valid) {
    logger.warn({ vehicleId: reading.vehicleId, reason: movement.reason }, 'rejected telemetry');
    return;
  }
  if (isRedundantParkedReading(reading, previous)) return;
  await repository.saveTelemetry(enrichTelemetry(reading, config.h3Resolution));
}

if (config.telemetryTransport === 'sqs') {
  if (!config.telemetryQueueUrl) throw new Error('TELEMETRY_QUEUE_URL is required for SQS transport');
  const sqs = createSqsClient(config.awsRegion);
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort());
  process.once('SIGINT', () => controller.abort());
  logger.info({ transport: 'sqs', queueUrl: config.telemetryQueueUrl }, 'telemetry service ready');
  await consumeQueue({
    client: sqs,
    queueUrl: config.telemetryQueueUrl,
    handler: processPayload,
    logger,
    signal: controller.signal
  });
} else if (config.telemetryTransport === 'mqtt') {
  const broker = await connectBroker('telemetry-service');
  await subscribe(broker, topics.telemetry);
  broker.on('message', async (_topic, payload) => {
    try {
      await processPayload(payload);
    } catch (error) {
      logger.error({ error }, 'failed to process telemetry');
    }
  });
  logger.info({ transport: 'mqtt' }, 'telemetry service ready');
} else {
  throw new Error(`Unsupported TELEMETRY_TRANSPORT: ${config.telemetryTransport}`);
}
