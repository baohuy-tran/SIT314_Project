import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTripCompletionEvent } from '../src/domain/trip.js';

test('a retried trip completion keeps the same idempotency key and payload', () => {
  const vehicle = {
    vehicleId: 'vehicle-00001',
    trip: { requestId: 'ride-123', startedAt: 1_000, drivenKm: 2.5 }
  };
  const first = buildTripCompletionEvent(vehicle, new Date(61_000));
  vehicle.trip.drivenKm = 2.7;
  const retry = buildTripCompletionEvent(vehicle, new Date(91_000));

  assert.strictEqual(retry, first);
  assert.equal(first.tripId, 'ride-123');
  assert.equal(first.durationSeconds, 60);
  assert.equal(first.distanceKm, 2.5);
  assert.equal(first.fare, 9.4);
});

test('trip completion requires an active request', () => {
  assert.throws(() => buildTripCompletionEvent({ vehicleId: 'vehicle-00001', trip: null }),
    /no active trip/);
});
