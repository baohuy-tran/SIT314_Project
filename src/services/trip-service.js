import { z } from 'zod';
import { config, topics } from '../config.js';
import { connectBroker, subscribe } from '../infra/broker.js';
import { FleetRepository, connectDatabase } from '../infra/mongo.js';
import { logger } from '../infra/logger.js';
import { consumeQueue, createSqsClient } from '../infra/sqs-consumer.js';

const eventSchema = z.object({
  tripId: z.string().min(1),
  requestId: z.string().min(1),
  vehicleId: z.string().min(1),
  completedAt: z.coerce.date(),
  distanceKm: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  fare: z.number().nonnegative()
});

const repository = new FleetRepository(await connectDatabase());
async function processTrip(payload) {
  await repository.completeTrip(eventSchema.parse(JSON.parse(payload.toString())));
}

if (config.tripTransport === 'sqs') {
  if (!config.tripQueueUrl) throw new Error('TRIP_QUEUE_URL is required for SQS trip events');
  const sqs = createSqsClient(config.awsRegion);
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort());
  process.once('SIGINT', () => controller.abort());
  logger.info({ transport: 'sqs', queueUrl: config.tripQueueUrl }, 'trip service ready');
  await consumeQueue({
    client: sqs,
    queueUrl: config.tripQueueUrl,
    handler: processTrip,
    logger,
    signal: controller.signal
  });
} else if (config.tripTransport === 'mqtt') {
  const broker = await connectBroker('trip-service');
  await subscribe(broker, topics.tripCompleted);
  logger.info({ transport: 'mqtt' }, 'trip service ready');
  broker.on('message', async (_topic, payload) => {
    try {
      await processTrip(payload);
    } catch (error) {
      logger.error({ error }, 'failed to complete trip');
    }
  });
} else {
  throw new Error(`Unsupported TRIP_TRANSPORT: ${config.tripTransport}`);
}
