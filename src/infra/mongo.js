import { MongoClient } from 'mongodb';
import { config } from '../config.js';
import { asGeoJson, fromGeoJson } from '../domain/geo.js';

let client;
let database;

export async function connectDatabase() {
  if (database) return database;
  client = new MongoClient(config.mongoUri);
  await client.connect();
  database = client.db(config.mongoDb);
  await ensureIndexes(database);
  return database;
}

async function ensureIndexes(db) {
  await Promise.all([
    db.collection('vehicles_live').createIndex({ position: '2dsphere' }),
    db.collection('vehicles_live').createIndex({ status: 1, h3Cell: 1 }),
    db.collection('position_history').createIndex({ timestamp: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 }),
    db.collection('rides').createIndex({ requestId: 1 }, { unique: true }),
    db.collection('rides').createIndex({ status: 1, requestedAt: -1 }),
    db.collection('trips').createIndex({ tripId: 1 }, { unique: true })
  ]);
}

export async function closeDatabase() {
  await client?.close();
  client = undefined;
  database = undefined;
}

export class FleetRepository {
  constructor(db) {
    this.db = db;
  }

  async getVehicle(vehicleId) {
    return this.db.collection('vehicles_live').findOne({ _id: vehicleId });
  }

  async saveTelemetry(reading) {
    const document = {
      vehicleId: reading.vehicleId,
      timestamp: reading.timestamp,
      position: asGeoJson(reading),
      speedKmh: reading.speedKmh,
      batteryPct: reading.batteryPct,
      status: reading.status,
      h3Cell: reading.h3Cell
    };
    await Promise.all([
      this.db.collection('vehicles_live').updateOne(
        { _id: reading.vehicleId },
        { $set: document },
        { upsert: true }
      ),
      // The MongoDB driver mutates inserted objects by adding `_id`. Use a
      // separate object so the concurrent live update never observes that id.
      this.db.collection('position_history').insertOne({ ...document })
    ]);
  }

  async findAvailableVehiclesNear(point, maxDistanceKm, limit = 25) {
    const docs = await this.db.collection('vehicles_live').find({
      status: 'idle',
      batteryPct: { $gte: 15 },
      position: {
        $near: {
          $geometry: asGeoJson(point),
          $maxDistance: maxDistanceKm * 1000
        }
      }
    }).limit(limit).toArray();
    return docs.map((doc) => ({ ...doc, vehicleId: doc._id, position: fromGeoJson(doc.position) }));
  }

  async createRide(request) {
    const requestedAt = new Date(request.requestedAt);
    await this.db.collection('rides').updateOne(
      { requestId: request.requestId },
      { $setOnInsert: {
        ...request,
        status: 'requested',
        requestedAt,
        statusHistory: [{ status: 'requested', at: requestedAt }]
      } },
      { upsert: true }
    );
  }

  async findRequestedRides(limit = 1000) {
    return this.db.collection('rides')
      .find({ status: 'requested' })
      .sort({ requestedAt: 1 })
      .limit(limit)
      .toArray();
  }

  async claimVehicle(assignment) {
    const { request, vehicle } = assignment;
    const assignedAt = assignment.assignedAt ?? new Date();
    const result = await this.db.collection('vehicles_live').updateOne(
      { _id: vehicle.vehicleId, status: 'idle', activeRideId: { $exists: false } },
      { $set: { status: 'assigned', activeRideId: request.requestId, assignedAt } }
    );
    if (result.modifiedCount !== 1) return false;

    const rideResult = await this.db.collection('rides').updateOne(
      { requestId: request.requestId, status: 'requested' },
      {
        $set: {
          status: 'assigned',
          vehicleId: vehicle.vehicleId,
          assignedAt,
          matchDistanceKm: assignment.distanceKm,
          pickupEtaSeconds: assignment.pickupEtaSeconds,
          dropoffEtaSeconds: assignment.dropoffEtaSeconds,
          estimatedPickupAt: assignment.estimatedPickupAt,
          estimatedDropoffAt: assignment.estimatedDropoffAt
        },
        $push: { statusHistory: { status: 'assigned', at: assignedAt, vehicleId: vehicle.vehicleId } }
      }
    );
    if (rideResult.modifiedCount !== 1) {
      await this.db.collection('vehicles_live').updateOne(
        { _id: vehicle.vehicleId, activeRideId: request.requestId },
        { $set: { status: 'idle' }, $unset: { activeRideId: '', assignedAt: '' } }
      );
      return false;
    }
    return true;
  }

  async completeTrip(event) {
    const completedAt = new Date(event.completedAt);
    await this.db.collection('trips').updateOne(
      { tripId: event.tripId },
      { $setOnInsert: { ...event, completedAt } },
      { upsert: true }
    );
    await Promise.all([
      this.db.collection('rides').updateOne(
        { requestId: event.requestId, vehicleId: event.vehicleId },
        {
          $set: { status: 'completed', completedAt },
          $push: { statusHistory: { status: 'completed', at: completedAt, vehicleId: event.vehicleId } }
        }
      ),
      this.db.collection('vehicles_live').updateOne(
        { _id: event.vehicleId, activeRideId: event.requestId },
        { $set: { status: 'idle' }, $unset: { activeRideId: '', assignedAt: '' } }
      )
    ]);
  }
}
