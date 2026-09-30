import { z } from 'zod';
import { haversineKm, toH3Cell } from './geo.js';

const telemetrySchema = z.object({
  vehicleId: z.string().min(1).max(100),
  timestamp: z.coerce.date(),
  lat: z.number().gte(-90).lte(90),
  lon: z.number().gte(-180).lte(180),
  speedKmh: z.number().gte(0).lte(250),
  batteryPct: z.number().gte(0).lte(100),
  status: z.enum(['idle', 'assigned', 'to_pickup', 'occupied', 'to_depot', 'maintenance'])
});

export function parseTelemetry(input) {
  return telemetrySchema.parse(input);
}

export function validateMovement(current, previous, options = {}) {
  const maxSpeedKmh = options.maxSpeedKmh ?? 130;
  if (!previous) return { valid: true };

  const elapsedHours = (current.timestamp.getTime() - previous.timestamp.getTime()) / 3_600_000;
  if (elapsedHours <= 0) return { valid: false, reason: 'non_increasing_timestamp' };

  const distanceKm = haversineKm(current, previous);
  const impliedSpeedKmh = distanceKm / elapsedHours;
  if (impliedSpeedKmh > maxSpeedKmh) {
    return { valid: false, reason: 'impossible_jump', impliedSpeedKmh };
  }
  return { valid: true, impliedSpeedKmh };
}

export function isRedundantParkedReading(current, previous) {
  return Boolean(
    previous
    && current.status === 'idle'
    && current.speedKmh === 0
    && previous.status === 'idle'
    && previous.speedKmh === 0
    && current.lat === previous.lat
    && current.lon === previous.lon
  );
}

export function enrichTelemetry(reading, h3Resolution = 8) {
  return { ...reading, h3Cell: toH3Cell(reading, h3Resolution) };
}

