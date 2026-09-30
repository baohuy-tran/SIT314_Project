import test from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm, toH3Cell } from '../src/domain/geo.js';

test('haversine returns a plausible Melbourne CBD distance', () => {
  const distance = haversineKm(
    { lat: -37.8136, lon: 144.9631 },
    { lat: -37.8183, lon: 144.9671 }
  );
  assert.ok(distance > 0.5 && distance < 0.8);
});

test('H3 cell is stable for a point', () => {
  const point = { lat: -37.8136, lon: 144.9631 };
  assert.equal(toH3Cell(point), toH3Cell(point));
  assert.equal(toH3Cell(point).length, 15);
});

