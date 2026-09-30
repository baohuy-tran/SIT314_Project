/**
 * Keep the completion payload stable while a publish is retried. A request can
 * complete only one trip, so its ID is also the trip's idempotency key.
 */
export function buildTripCompletionEvent(vehicle, now = new Date()) {
  const trip = vehicle.trip;
  if (!trip?.requestId) throw new Error('vehicle has no active trip');
  if (trip.completionEvent) return trip.completionEvent;

  const durationSeconds = Math.round((now.getTime() - trip.startedAt) / 1000);
  trip.completionEvent = {
    tripId: trip.requestId,
    requestId: trip.requestId,
    vehicleId: vehicle.vehicleId,
    completedAt: now.toISOString(),
    distanceKm: Number(trip.drivenKm.toFixed(3)),
    durationSeconds,
    fare: Number((4.5 + trip.drivenKm * 1.8 + durationSeconds / 60 * 0.4).toFixed(2))
  };
  return trip.completionEvent;
}
