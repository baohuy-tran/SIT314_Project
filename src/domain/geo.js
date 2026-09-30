import { latLngToCell } from 'h3-js';

const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(a, b) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const dLat = lat2 - lat1;
  const dLon = radians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function toH3Cell(point, resolution = 8) {
  return latLngToCell(point.lat, point.lon, resolution);
}

export function asGeoJson(point) {
  return { type: 'Point', coordinates: [point.lon, point.lat] };
}

export function fromGeoJson(location) {
  return { lon: location.coordinates[0], lat: location.coordinates[1] };
}

