# Scalable Ride Matching System

This repository is a runnable local MVP of the architecture proposed in `Doc2.pdf` for a driverless taxi fleet. It demonstrates the correctness-critical path: MQTT telemetry, validation, H3 tagging, geospatial storage, batched matching, atomic vehicle claims, dispatch, trip completion and load generation.

## What is implemented

- Vehicle simulator with `idle -> to_pickup -> occupied -> idle` lifecycle.
- Telemetry validation (schema, bounds, impossible jumps), parked-reading suppression and H3 tagging.
- Separate `vehicles_live` and seven-day TTL `position_history` collections.
- Rider REST API and durable QoS 1 MQTT events for local development.
- Two-second request batches, nearby-car search and one-to-one assignment.
- MongoDB conditional updates to prevent a vehicle being claimed twice.
- Dispatch commands back to the selected vehicle.
- Pickup/drop-off ETA calculation at assignment time and a rider-visible status history.
- Completed trip records with distance, duration and fare.
- Stable trip-completion payloads on publish retry; each ride request ID is the trip's idempotency key, and simulator ticks do not overlap.
- Prometheus-format API metrics and a configurable 500-to-5,000 vehicle load profile.
- Unit tests for distance/H3, validation, matching invariants and trip-completion retries.

## Run locally

Prerequisites: Docker Desktop and Node.js 20 or newer.

```bash
npm install
docker compose up --build -d
VEHICLE_COUNT=20 npm run simulator
```

In a second terminal, create clustered demand:

```bash
npm run generate:rides -- 10
```

Or create one request through the REST API:

```bash
curl -X POST http://localhost:3000/api/rides \
  -H 'content-type: application/json' \
  -d '{"pickup":{"lat":-37.8136,"lon":144.9631},"dropoff":{"lat":-37.82,"lon":144.98}}'
```

Use the returned `requestId` with `GET /api/rides/:requestId`. Current fleet state is available from `GET /api/vehicles`, completed trips from `GET /api/trips`, and metrics from `GET /metrics`.

Once a vehicle is assigned, the ride response includes `pickupEtaSeconds`,
`dropoffEtaSeconds`, `estimatedPickupAt`, `estimatedDropoffAt` and a
`statusHistory` array. The history records the `requested`, `assigned` and
`completed` transitions, providing a simple polling-based rider notification
feed. Override the ETA model with `ETA_AVERAGE_SPEED_KMH` (default: 30).

Set `API_AUTH_TOKEN` in a deployed environment to protect every `/api/*`
endpoint. `/health` remains public for load-balancer health checks. Clients then
send the token without putting it in the URL:

```bash
curl http://localhost:3000/api/vehicles \
  -H "Authorization: Bearer $API_AUTH_TOKEN"
```

Stop the stack with `docker compose down`. Add `-v` only when you intentionally want to delete the local MongoDB data.

## Test

```bash
npm test
```

## Deploy an application revision to ECS

After starting AWS Academy Learner Lab, place its temporary credentials in the
standard AWS CLI profile and verify `aws sts get-caller-identity` succeeds. The
deployment script builds one immutable Linux image, pushes it to ECR, copies
each service's current task definition while replacing only the image, and
waits for all ECS rollouts to stabilise:

```bash
AWS_REGION=us-east-1 \
ECR_REPOSITORY=ride-matching \
ECS_CLUSTER=ride-matching-cluster \
ECS_SERVICES=api-service,matching-service,trip-service \
./scripts/deploy-ecs.sh
```

Override `IMAGE_TAG` when a human-readable evidence tag is required. Learner
Lab credentials expire, so the script intentionally performs an STS check
before building or changing ECS.

For a short load rehearsal (small values are safer on a laptop):

```bash
BASELINE_VEHICLES=50 PEAK_VEHICLES=500 RAMP_STEPS=5 npm run load
```

To measure the deployed REST API without creating ride records, load-test its
health endpoint:

```bash
API_BASE_URL=http://PUBLIC_IP:3000 \
LOAD_REQUESTS=200 \
LOAD_CONCURRENCY=20 \
npm run load:http
```

The command reports success rate, requests per second and p50/p95/p99 latency.
The public Fargate IP is temporary, so retrieve it again after task replacement.

For a certificate-scoped AWS IoT telemetry rate test, use the Thing's existing
certificate paths and vary `TELEMETRY_MESSAGES` and `TELEMETRY_INTERVAL_MS`:

```bash
MQTT_CA_PATH="$PWD/certs/AmazonRootCA1.pem" \
MQTT_CERT_PATH="$PWD/certs/device.pem.crt" \
MQTT_KEY_PATH="$PWD/certs/private.pem.key" \
TELEMETRY_MESSAGES=200 \
TELEMETRY_INTERVAL_MS=10 \
npm run load:telemetry
```

The included Thing policy binds the client identity and publish topic to one
Thing, so this measures message rate for `vehicle-00001`; it must not be
described as a multi-vehicle identity test.

The proposal's full experiment is the default (`500 -> 5,000 -> 500`). Run it only after confirming Docker has enough CPU and memory.

## Architecture mapping

| Proposal component | Local implementation | AWS production replacement |
|---|---|---|
| AWS IoT Core / MQTT over TLS | Eclipse Mosquitto | AWS IoT Core on port 8883 with one X.509 identity per vehicle |
| Node-RED validation | Node-RED monitoring flow + `telemetry-service.js` persistence | Node-RED monitor or independently scaled ECS ingestion task |
| SNS + per-service SQS | QoS 1 MQTT event topics | SNS fan-out to one SQS queue per consumer, with DLQs |
| Fargate microservices | Docker Compose services | ECS Fargate services in private subnets |
| MongoDB Atlas | Local MongoDB | Atlas private endpoint, backups and S3 archive |
| CloudWatch | Structured logs + `/metrics` | CloudWatch Container Insights, queue depth and custom match latency |

Local Mosquitto intentionally permits anonymous clients so the project starts without certificates. This is **development-only**. Production must use `mqtts://`, the `MQTT_CA_PATH`, `MQTT_CERT_PATH` and `MQTT_KEY_PATH` settings, AWS IoT policies scoped to each vehicle, and no public database endpoint.

### Monitor telemetry with Node-RED

The Compose stack includes a monitoring-only Node-RED flow. It subscribes to
`fleet/vehicles/+/telemetry`, validates the message shape, and sends valid and
invalid messages to separate Debug nodes. It deliberately does not write to
MongoDB, because the telemetry service remains the only persistence consumer.

Start the local broker and Node-RED:

```bash
docker compose up -d mqtt node-red
```

Open `http://localhost:1880`, select **Fleet telemetry monitor**, and open the
Debug sidebar. Run the simulator with `MQTT_URL=mqtt://localhost:1883` to see
validated telemetry messages.

### Connect one simulator vehicle to AWS IoT Core

Download the Thing certificate, private key and Amazon Root CA into a local
`certs/` directory (which is ignored by Git), then run:

```bash
MQTT_URL=mqtts://YOUR_ENDPOINT-ats.iot.us-east-1.amazonaws.com:8883 \
MQTT_CLIENT_ID=vehicle-00001 \
MQTT_CA_PATH="$PWD/certs/AmazonRootCA1.pem" \
MQTT_CERT_PATH="$PWD/certs/device.pem.crt" \
MQTT_KEY_PATH="$PWD/certs/private.pem.key" \
VEHICLE_COUNT=1 \
npm run simulator
```

The MQTT client ID must match the AWS IoT Thing name when using the included
least-privilege Thing policy. Never commit `private.pem.key`.

For the project evidence pack, the simulator now logs `MQTT broker connected`
after the broker handshake and `telemetry published` after its first successful
tick, then every tenth tick. Capture those terminal lines together with the
same telemetry topic in AWS IoT MQTT Test Client and the stored Atlas record.
The local publish log by itself does not prove the cloud received the message.

To verify the complete AWS telemetry path automatically, run the following with
the same certificate variables. It publishes one harmless idle-position sample
and waits until its timestamp appears in Atlas:

```bash
MQTT_URL=mqtts://YOUR_ENDPOINT-ats.iot.us-east-1.amazonaws.com:8883 \
MQTT_CLIENT_ID=vehicle-00001 \
MQTT_CA_PATH="$PWD/certs/AmazonRootCA1.pem" \
MQTT_CERT_PATH="$PWD/certs/device.pem.crt" \
MQTT_KEY_PATH="$PWD/certs/private.pem.key" \
npm run verify:telemetry
```

A successful run prints both `"stage":"mqtt","result":"published"` and
`"stage":"pipeline","result":"verified"`. The second line proves that the
message passed through IoT Core, the telemetry rule/queue, the ECS consumer and
MongoDB Atlas within the configured timeout.

### Consume AWS IoT telemetry from SQS

The telemetry worker supports both the local MQTT transport and the AWS SQS
transport. In ECS, assign the task a role that permits `sqs:ReceiveMessage`,
`sqs:DeleteMessage` and `sqs:GetQueueAttributes`, then set:

```bash
TELEMETRY_TRANSPORT=sqs
AWS_REGION=us-east-1
TELEMETRY_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/ACCOUNT_ID/telemetry-ingest
MONGO_URI=mongodb+srv://...
```

SQS is long-polled for up to ten messages at a time. A message is deleted only
after validation and MongoDB persistence succeed; repeated failures are moved
to `telemetry-ingest-dlq` by the queue redrive policy.

### Run the ride workflow on AWS

The API can send ride requests directly to SQS, the matcher can consume those
requests and publish dispatch commands through the AWS IoT data plane, and the
trip worker can consume completed-trip events from a second SQS queue. ECS uses
its task role for these calls; no AWS access keys belong in the container.

API task:

```bash
RIDE_REQUEST_TRANSPORT=sqs
RIDE_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/ACCOUNT_ID/ride-requests
```

If the API task is exposed directly with a Fargate public IP, its public IP can
change whenever ECS replaces the task. Directly opening port 3000 and running
without rider authentication is suitable only for a temporary demonstration.
A production deployment should place the service behind an HTTPS load balancer,
add authentication and restrict the task security group to traffic from the
load balancer only.

Matching task:

```bash
MATCHING_TRANSPORT=sqs
RIDE_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/ACCOUNT_ID/ride-requests
DISPATCH_TRANSPORT=iot
IOT_DATA_ENDPOINT=YOUR_ENDPOINT-ats.iot.us-east-1.amazonaws.com
```

Trip task:

```bash
TRIP_TRANSPORT=sqs
TRIP_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/ACCOUNT_ID/trip-events
```

All three tasks also need `AWS_REGION`, `MONGO_DB` and the Secrets Manager
reference for `MONGO_URI`. Route `fleet/events/trip-completed` to `trip-events`
with an AWS IoT rule. Give the task role only the applicable SQS actions and
`iot:Publish` on `fleet/vehicles/*/commands` for the matcher.

## Important design notes

The in-memory request batch is suitable for this single local matcher. In AWS, ride requests should be consumed from SQS with a visibility timeout and idempotency based on `requestId`; zone ownership should ensure that only one matcher works a city partition. The MongoDB vehicle claim remains the final correctness guard even when zone ownership fails.

The matcher currently uses globally greedy nearest edges. It guarantees one request/one vehicle within a batch, but it does not minimize total fleet distance as precisely as the Hungarian algorithm. That is a deliberate MVP boundary and a clear extension point for the assignment-algorithm experiment.

Before claiming production readiness, add infrastructure-as-code, authenticated rider access, dead-letter queues, distributed tracing, an outbox/transaction strategy for claim-plus-dispatch, zone rebalance logic, dashboards and fault-injection tests. QoS 1 is at-least-once delivery, so all event consumers must remain idempotent.

The trip worker upserts completed trips by `tripId`. The simulator now uses the ride `requestId` as that key and reuses the same completion payload if publishing needs a retry. This prevents a retry from creating a second trip document, but a full restart/failure-injection test across MQTT, SQS and MongoDB is still required.
