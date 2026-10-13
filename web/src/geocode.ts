// Reverse geocoding with OpenStreetMap Nominatim (free, no key).
// Usage policy: at most 1 request per second, identify the app, cache results. https://operations.osmfoundation.org/policies/nominatim/

export interface PlaceInfo {
  name: string // nearest named feature; may be a shop inside the building rather than the building itself
  address: string // road, sub-district, district, province
}

/** GPS of the same building drifts by tens of metres between visits (same value as the API). */
const MATCH_RADIUS_METERS = 100

export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = (d: number) => (d * Math.PI) / 180
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a))
}

/** Same Google place id first; otherwise the nearest saved place within 100 m. */
export function matchPlace<T extends { placeId: string | null; lat: number; lng: number }>(
  saved: T[],
  placeId: string,
  lat: number | null,
  lng: number | null,
): T | undefined {
  const byId = saved.find((s) => s.placeId === placeId)
  if (byId || lat === null || lng === null) return byId
  let best: T | undefined
  let bestDistance = MATCH_RADIUS_METERS
  for (const s of saved) {
    const d = distanceMeters(lat, lng, s.lat, s.lng)
    if (d <= bestDistance) [best, bestDistance] = [s, d]
  }
  return best
}

const ADDRESS_PARTS = ['road', 'quarter', 'suburb', 'city_district', 'district', 'county', 'town', 'city', 'state']
const MIN_INTERVAL_MS = 1100
let lastRequest = 0

export async function reverseGeocode(lat: number, lng: number): Promise<PlaceInfo> {
  const wait = lastRequest + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequest = Date.now()

  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=th&lat=${lat}&lon=${lng}`
  const res = await fetch(url, { referrerPolicy: 'origin' }) // browsers cannot set User-Agent; the Referer identifies the app
  if (!res.ok) throw new Error(`OpenStreetMap ${res.status}`)
  const body = await res.json()
  if (body.error) throw new Error(`OpenStreetMap: ${body.error}`)

  const address: Record<string, string> = body.address ?? {}
  const parts = [...new Set(ADDRESS_PARTS.map((k) => address[k]).filter(Boolean))]
  return { name: body.name ?? '', address: parts.join(', ') }
}
