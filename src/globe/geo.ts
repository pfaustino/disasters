import * as THREE from 'three'

export const GLOBE_RADIUS = 1
export const PACIFIC_LAT = 0
export const PACIFIC_LON = -160
export const CAMERA_DISTANCE = 4.6

const DEG = Math.PI / 180

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
