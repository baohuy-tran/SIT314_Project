import { z } from 'zod';
import { config, topics } from '../config.js';
import { buildAssignments, estimateTripEtas } from '../domain/matching.js';
import { connectBroker, publishJson, subscribe } from '../infra/broker.js';
import { createIotPublisher, publishIotJson } from '../infra/iot-publisher.js';
import { FleetRepository, connectDatabase } from '../infra/mongo.js';
import { logger } from '../infra/logger.js';
import { consumeQueue, createSqsClient } from '../infra/sqs-consumer.js';

const point = z.object({ lat: z.number().gte(-90).lte(90), lon: z.number().gte(-180).lte(180) });
const rideSchema = z.object({
  requestId: z.string().min(1),
  requestedAt: z.coerce.date(),
  pickup: point,
  dropoff: point
});

const repository = new FleetRepository(await connectDatabase());
const pending = new Map();

async function acceptRequest(payload) {
  const request = rideSchema.parse(JSON.parse(payload.toString()));
  await repository.createRide(request);
  pending.set(request.requestId, request);
}

let publishDispatch;
let broker;
if (config.dispatchTransport === 'iot') {
  const iot = createIotPublisher(config.awsRegion, config.iotDataEndpoint);
  publishDispatch = (topic, command) => publishIotJson(iot, topic, command);
} else if (config.dispatchTransport === 'mqtt') {
  broker = await connectBroker(`matching-service-${process.pid}`);
  publishDispatch = (topic, command) => publishJson(broker, topic, command);
} else {
  throw new Error(`Unsupported DISPATCH_TRANSPORT: ${config.dispatchTransport}`);
}

if (config.matchingTransport === 'mqtt') {
  if (!broker) broker = await connectBroker(`matching-service-${process.pid}`);
  await subscribe(broker, topics.rideRequested);
  broker.on('message', async (_topic, payload) => {
    try {
      await acceptRequest(payload);
    } catch (error) {
      logger.error({ error }, 'invalid ride request');
    }
  });
} else if (config.matchingTransport === 'sqs') {
  if (!config.rideQueueUrl) throw new Error('RIDE_QUEUE_URL is required for SQS matching');
  const sqs = createSqsClient(config.awsRegion);
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort());
  process.once('SIGINT', () => controller.abort());
  consumeQueue({
    client: sqs,
    queueUrl: config.rideQueueUrl,
    handler: acceptRequest,
    logger,
    signal: controller.signal
  }).catch((error) => logger.fatal({ error }, 'ride queue consumer stopped'));
} else {
  throw new Error(`Unsupported MATCHING_TRANSPORT: ${config.matchingTransport}`);
}

async function matchBatch() {
  // Reload requested rides from durable storage so a task restart after SQS
  // acknowledgement cannot lose work that was already persisted. MongoDB is
  // also the source of truth for cancellation/completion, so discard stale
  // in-memory entries before rebuilding the next batch.
  const storedRequests = await repository.findRequestedRides();
  pending.clear();
  for (const request of storedRequests) pending.set(request.requestId, request);
  const requests = [...pending.values()];
  if (requests.length === 0) return;

  const candidates = new Map(await Promise.all(requests.map(async (request) => [
    request.requestId,
    await repository.findAvailableVehiclesNear(request.pickup, config.maxMatchDistanceKm)
  ])));
  const assignments = buildAssignments(requests, candidates, config.maxMatchDistanceKm);
  let matched = 0;
  for (const assignment of assignments) {
    const { request, vehicle, distanceKm } = assignment;
    const assignedAt = new Date();
    const eta = estimateTripEtas({
      vehiclePosition: vehicle.position,
      pickup: request.pickup,
      dropoff: request.dropoff,
      assignedAt,
      averageSpeedKmh: config.etaAverageSpeedKmh
    });
    const assignmentWithEta = { ...assignment, assignedAt, ...eta };
    if (!await repository.claimVehicle(assignmentWithEta)) continue;
    await publishDispatch(topics.dispatchFor(vehicle.vehicleId), {
      type: 'dispatch',
      requestId: request.requestId,
      pickup: request.pickup,
      dropoff: request.dropoff,
      matchDistanceKm: distanceKm,
      assignedAt: assignedAt.toISOString(),
      pickupEtaSeconds: eta.pickupEtaSeconds,
      dropoffEtaSeconds: eta.dropoffEtaSeconds,
      estimatedPickupAt: eta.estimatedPickupAt.toISOString(),
      estimatedDropoffAt: eta.estimatedDropoffAt.toISOString()
    });
    matched += 1;
  }
  // Unmatched rides remain `requested` in MongoDB and are loaded again in the
  // next batch. This avoids stale memory retrying rides already completed or
  // cancelled by another service.
  logger.info({ requests: requests.length, matched }, 'batch complete');
}

setInterval(() => matchBatch().catch((error) => logger.error({ error }, 'batch failed')), config.batchWindowMs).unref();
logger.info({
  batchWindowMs: config.batchWindowMs,
  transport: config.matchingTransport,
  dispatchTransport: config.dispatchTransport
}, 'matching service ready');
