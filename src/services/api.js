import crypto from 'node:crypto';
import express from 'express';
import client from 'prom-client';
import { z } from 'zod';
import { config, topics } from '../config.js';
import { connectBroker, publishJson } from '../infra/broker.js';
import { connectDatabase } from '../infra/mongo.js';
import { logger } from '../infra/logger.js';
import { createSqsClient, sendJson } from '../infra/sqs-consumer.js';
import { createApiAuth } from '../http/api-auth.js';

const point = z.object({ lat: z.number().gte(-90).lte(90), lon: z.number().gte(-180).lte(180) });
const requestSchema = z.object({ pickup: point, dropoff: point });
const requestLatency = new client.Histogram({
  name: 'ride_request_publish_seconds',
  help: 'Time to validate and publish a ride request',
  buckets: [0.01, 0.05, 0.1, 0.5, 1]
});
client.collectDefaultMetrics();

const db = await connectDatabase();
let publishRideRequest;
if (config.rideRequestTransport === 'sqs') {
  if (!config.rideQueueUrl) throw new Error('RIDE_QUEUE_URL is required for SQS ride requests');
  const sqs = createSqsClient(config.awsRegion);
  publishRideRequest = (ride) => sendJson(sqs, config.rideQueueUrl, ride);
} else if (config.rideRequestTransport === 'mqtt') {
  const broker = await connectBroker('rider-api');
  publishRideRequest = (ride) => publishJson(broker, topics.rideRequested, ride);
} else {
  throw new Error(`Unsupported RIDE_REQUEST_TRANSPORT: ${config.rideRequestTransport}`);
}
const app = express();
app.use(express.json({ limit: '32kb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/metrics', async (_req, res) => {
  res.type(client.register.contentType).send(await client.register.metrics());
});

app.use('/api', createApiAuth(config.apiAuthToken));

app.post('/api/rides', async (req, res, next) => {
  const end = requestLatency.startTimer();
  try {
    const input = requestSchema.parse(req.body);
    const ride = {
      requestId: crypto.randomUUID(),
      requestedAt: new Date().toISOString(),
      ...input
    };
    await publishRideRequest(ride);
    end();
    res.status(202).json(ride);
  } catch (error) {
    end();
    next(error);
  }
});

app.get('/api/rides/:requestId', async (req, res) => {
  const ride = await db.collection('rides').findOne({ requestId: req.params.requestId }, { projection: { _id: 0 } });
  if (!ride) return res.status(404).json({ error: 'ride_not_found' });
  res.json(ride);
});
app.get('/api/vehicles', async (_req, res) => {
  res.json(await db.collection('vehicles_live').find({}, { projection: { _id: 0 } }).limit(1000).toArray());
});
app.get('/api/trips', async (_req, res) => {
  res.json(await db.collection('trips').find({}, { projection: { _id: 0 } }).sort({ completedAt: -1 }).limit(100).toArray());
});

app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'invalid_request', details: error.issues });
  logger.error({ error }, 'request failed');
  res.status(500).json({ error: 'internal_error' });
});

app.listen(config.port, () => logger.info({ port: config.port, transport: config.rideRequestTransport }, 'API ready'));
