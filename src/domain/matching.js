import { haversineKm } from './geo.js';

export function estimateTripEtas({ vehiclePosition, pickup, dropoff, assignedAt = new Date(), averageSpeedKmh = 30 }) {
  if (!(averageSpeedKmh > 0)) throw new Error('averageSpeedKmh must be greater than zero');
  const pickupDistanceKm = haversineKm(vehiclePosition, pickup);
  const tripDistanceKm = haversineKm(pickup, dropoff);
  const pickupEtaSeconds = Math.ceil(pickupDistanceKm / averageSpeedKmh * 3600);
  const dropoffEtaSeconds = pickupEtaSeconds + Math.ceil(tripDistanceKm / averageSpeedKmh * 3600);

  return {
    pickupEtaSeconds,
    dropoffEtaSeconds,
    estimatedPickupAt: new Date(assignedAt.getTime() + pickupEtaSeconds * 1000),
    estimatedDropoffAt: new Date(assignedAt.getTime() + dropoffEtaSeconds * 1000)
  };
}

/**
 * Produces a globally greedy one-to-one assignment. All feasible request/vehicle
 * edges are sorted by distance, so a vehicle and a request can each be used once.
 * Atomic persistence is still required because other matcher processes may race.
 */
export function buildAssignments(requests, candidatesByRequest, maxDistanceKm = 8) {
  const edges = [];
  for (const request of requests) {
    for (const vehicle of candidatesByRequest.get(request.requestId) ?? []) {
      const distanceKm = haversineKm(request.pickup, vehicle.position);
      if (distanceKm <= maxDistanceKm) edges.push({ request, vehicle, distanceKm });
    }
  }
  edges.sort((a, b) => a.distanceKm - b.distanceKm
    || a.request.requestId.localeCompare(b.request.requestId)
    || a.vehicle.vehicleId.localeCompare(b.vehicle.vehicleId));

  const usedRequests = new Set();
  const usedVehicles = new Set();
  const assignments = [];
  for (const edge of edges) {
    if (usedRequests.has(edge.request.requestId) || usedVehicles.has(edge.vehicle.vehicleId)) continue;
    usedRequests.add(edge.request.requestId);
    usedVehicles.add(edge.vehicle.vehicleId);
    assignments.push(edge);
  }
  return assignments;
}
