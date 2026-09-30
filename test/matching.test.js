import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssignments, estimateTripEtas } from '../src/domain/matching.js';

test('assigns every vehicle and request at most once', () => {
  const requests = [
    { requestId: 'r1', pickup: { lat: 0, lon: 0 } },
    { requestId: 'r2', pickup: { lat: 0, lon: 0.01 } }
  ];
  const v1 = { vehicleId: 'v1', position: { lat: 0, lon: 0.001 } };
  const v2 = { vehicleId: 'v2', position: { lat: 0, lon: 0.011 } };
  const candidates = new Map([['r1', [v1, v2]], ['r2', [v1, v2]]]);
  const assignments = buildAssignments(requests, candidates, 5);
  assert.equal(assignments.length, 2);
  assert.equal(new Set(assignments.map((a) => a.vehicle.vehicleId)).size, 2);
  assert.equal(new Set(assignments.map((a) => a.request.requestId)).size, 2);
});

test('does not assign a vehicle outside the distance limit', () => {
  const request = { requestId: 'r1', pickup: { lat: 0, lon: 0 } };
  const far = { vehicleId: 'v1', position: { lat: 1, lon: 1 } };
  assert.deepEqual(buildAssignments([request], new Map([['r1', [far]]]), 5), []);
});

test('estimates pickup and drop-off times from route distance', () => {
  const assignedAt = new Date('2026-10-01T00:00:00.000Z');
  const eta = estimateTripEtas({
    vehiclePosition: { lat: 0, lon: 0 },
    pickup: { lat: 0, lon: 0.01 },
    dropoff: { lat: 0, lon: 0.02 },
    assignedAt,
    averageSpeedKmh: 36
  });

  assert.ok(eta.pickupEtaSeconds >= 111 && eta.pickupEtaSeconds <= 112);
  assert.ok(eta.dropoffEtaSeconds >= 222 && eta.dropoffEtaSeconds <= 224);
  assert.equal(eta.estimatedPickupAt.toISOString(), new Date(assignedAt.getTime() + eta.pickupEtaSeconds * 1000).toISOString());
  assert.equal(eta.estimatedDropoffAt.toISOString(), new Date(assignedAt.getTime() + eta.dropoffEtaSeconds * 1000).toISOString());
});

test('rejects a non-positive ETA speed', () => {
  assert.throws(() => estimateTripEtas({
    vehiclePosition: { lat: 0, lon: 0 },
    pickup: { lat: 0, lon: 0 },
    dropoff: { lat: 0, lon: 0 },
    averageSpeedKmh: 0
  }), /greater than zero/);
});
