import * as THREE from 'three'

export const GLOBE_RADIUS = 1
// Default view: 200 statute miles due west of Punta Eugenia (Baja California's
// western tip, ~27.846°N, 115.085°W). At this latitude, 1° lon ≈ 61.17 mi,
// so 200 mi ≈ 3.27° → 27.85°N, 118.36°W.
export const PACIFIC_LAT = 27.85
export const PACIFIC_LON = -118.36
export const CAMERA_DISTANCE = 4.6

const DEG = Math.PI / 180

export function lerpLongitude(a: number, b: number, t: number): number {
  let delta = b - a
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  let lon = a + delta * t
  if (lon > 180) lon -= 360
  if (lon < -180) lon += 360
  return lon
}

export function latLonToVector3(
  lat: number,
  lon: number,
  radius: number,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  const phi = (90 - lat) * DEG
  const theta = (lon + 180) * DEG
  const sinPhi = Math.sin(phi)
  return target.set(
    -radius * sinPhi * Math.cos(theta),
    radius * Math.cos(phi),
    radius * sinPhi * Math.sin(theta),
  )
}

export function magToRadius(mag: number): number {
  const m = Math.max(0, mag)
  const radius = 0.014 * 10 ** (m / 8)
  return Math.min(0.22, Math.max(0.016, radius))
}

export function magToLifetime(mag: number): number {
  return 0.35 + Math.max(0, mag) * 0.28
}

export function depthToColor(depthKm: number | null, target: THREE.Color): THREE.Color {
  const d = depthKm ?? 10
  if (d <= 70) {
    const t = d / 70
    return target.setRGB(1, 0.38 + 0.42 * t, 0.12 + 0.18 * t)
  }
  const t = Math.min(1, (d - 70) / 430)
  return target.setRGB(1 - 0.72 * t, 0.8 - 0.38 * t, 0.3 + 0.68 * t)
}

export function depthToOpacity(depthKm: number | null): number {
  const d = depthKm ?? 10
  return 0.92 - 0.5 * Math.min(1, d / 300)
}
