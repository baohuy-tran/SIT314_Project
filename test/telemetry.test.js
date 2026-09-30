import test from 'node:test';
import assert from 'node:assert/strict';
import { isRedundantParkedReading, parseTelemetry, validateMovement } from '../src/domain/telemetry.js';

const reading = {
  vehicleId: 'vehicle-1', timestamp: new Date('2026-01-01T00:00:01Z'),
  lat: -37.8136, lon: 144.9631, speedKmh: 0, batteryPct: 90, status: 'idle'
};

test('rejects impossible GPS jumps', () => {
  const result = validateMovement(reading, {
    ...reading, timestamp: new Date('2026-01-01T00:00:00Z'), lat: -37.8, lon: 144.9
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'impossible_jump');
});

test('removes identical parked readings', () => {
  assert.equal(isRedundantParkedReading(reading, { ...reading }), true);
});

test('validates telemetry boundaries', () => {
  assert.equal(parseTelemetry({ ...reading, timestamp: reading.timestamp.toISOString() }).vehicleId, 'vehicle-1');
  assert.throws(() => parseTelemetry({ ...reading, batteryPct: 101 }));
});

