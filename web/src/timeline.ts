// Google Maps Timeline export (on-device). Parsed in the browser only: location history never leaves the machine.
// Android: { semanticSegments: [...] }, iOS: [...]; each segment may hold a `visit` with a place id and local timestamps.

export interface Visit {
  key: string
  placeId: string
  date: string // yyyy-MM-dd (local, from the timestamp's own offset)
  startMinute: number // from midnight of `date`
  endMinute: number // may exceed 1440 when the visit runs past midnight
}

export interface Place {
  id: string
  semanticType: string // most frequent known type: INFERRED_WORK, INFERRED_HOME, WORK, HOME... else UNKNOWN
  lat: number | null
  lng: number | null
  hours: number
  visits: number
  typicalArrival: number // median minutes from midnight
  typicalDeparture: number
}

export interface Timeline {
  visits: Visit[]
  places: Place[] // most hours first
  from: string
  to: string
}

const DAY_MS = 86_400_000

/** "2026-09-24T12:56:00.000+07:00" → local date and minutes, read straight from the string. */
function localParts(iso: string) {
  return { date: iso.slice(0, 10), minute: Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16)) }
}

function parseLatLng(value: unknown): [number, number] | null {
  const raw = typeof value === 'string' ? value : (value as { latLng?: string } | undefined)?.latLng
  const m = raw?.match(/(-?\d+(?:\.\d+)?)°?,\s*(-?\d+(?:\.\d+)?)/)
  return m ? [Number(m[1]), Number(m[2])] : null
}

export function parseTimeline(text: string): Timeline {
  const json = JSON.parse(text)
  const segments: any[] = Array.isArray(json) ? json : json?.semanticSegments
  if (!Array.isArray(segments)) throw new Error('ไม่ใช่ไฟล์ Timeline ที่รองรับ (ต้องเป็นไฟล์ที่ export จาก Google Maps บนมือถือ)')

  const visits: Visit[] = []
  const places = new Map<string, Place>()
  const types = new Map<string, Map<string, number>>() // Google labels the same place differently per visit
  for (const s of segments) {
    const candidate = s?.visit?.topCandidate
    const placeId: string | undefined = candidate?.placeId ?? candidate?.placeID
    if (!placeId || !s.startTime || !s.endTime) continue

    const start = localParts(s.startTime)
    const end = localParts(s.endTime)
    const dayDiff = Math.round((Date.parse(end.date) - Date.parse(start.date)) / DAY_MS)
    const visit = { key: `${placeId}|${s.startTime}`, placeId, date: start.date, startMinute: start.minute, endMinute: end.minute + dayDiff * 1440 }
    if (visit.endMinute <= visit.startMinute) continue
    visits.push(visit)

    if (!places.has(placeId)) {
      const latLng = parseLatLng(candidate.placeLocation)
      places.set(placeId, {
        id: placeId,
        semanticType: 'UNKNOWN',
        lat: latLng?.[0] ?? null,
        lng: latLng?.[1] ?? null,
        hours: 0,
        visits: 0,
        typicalArrival: 0,
        typicalDeparture: 0,
      })
    }

    const type = candidate.semanticType
    if (type && type !== 'UNKNOWN') {
      const counts = types.get(placeId) ?? new Map<string, number>()
      counts.set(type, (counts.get(type) ?? 0) + 1)
      types.set(placeId, counts)
    }
  }

  for (const place of places.values()) {
    const counts = [...(types.get(place.id) ?? [])].sort((a, b) => b[1] - a[1])
    if (counts.length) place.semanticType = counts[0][0]
  }

  if (visits.length === 0) throw new Error('ไม่พบข้อมูลการไปสถานที่ (visit) ในไฟล์นี้')
  const dates = visits.map((v) => v.date).sort()
  return { visits, places: summarize([...places.values()], visits), from: dates[0], to: dates.at(-1)! }
}

/** Places visited between `from` and `to` (inclusive), with hours / visits / typical times counted in that range only. */
export function placesBetween(timeline: Timeline, from: string, to: string): Place[] {
  return summarize(timeline.places, timeline.visits.filter((v) => v.date >= from && v.date <= to))
}

/** Recomputes the stats of `places` from `visits`; places without visits are dropped. Most hours first. */
function summarize(places: Place[], visits: Visit[]): Place[] {
  const byPlace = new Map<string, Visit[]>()
  for (const v of visits) byPlace.set(v.placeId, [...(byPlace.get(v.placeId) ?? []), v])
  return places
    .filter((p) => byPlace.has(p.id))
    .map((p) => {
      const own = byPlace.get(p.id)!
      return {
        ...p,
        hours: own.reduce((sum, v) => sum + (v.endMinute - v.startMinute) / 60, 0),
        visits: own.length,
        typicalArrival: median(own.map((v) => v.startMinute)),
        typicalDeparture: median(own.map((v) => v.endMinute % 1440)),
      }
    })
    .sort((a, b) => b.hours - a.hours)
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

export interface Suggestion {
  key: string
  date: string
  start: number // minutes from midnight; end may exceed 1440
  end: number
  placeId: string
  arrival: number
  departure: number
}

const DAY_START = 8 * 60 + 30
const DAY_END = 18 * 60

/**
 * Ticked work visits → OT suggestions. All ticked visits of a day form one span, first arrival to last departure
 * (the user ticks by hand, so gaps such as lunch are not split out). Each span gives:
 *  - weekend / holiday: arrival–departure
 *  - weekday: arrival–08:30 and 18:00–departure, when each is at least `minMinutes`
 * Arrival is rounded up and departure is stretched up to the next `roundTo` minutes (22:14 → 22:30 with 30).
 */
export function suggest(
  visits: Visit[],
  isOffDay: (date: string) => boolean,
  roundTo: number,
  minMinutes: number,
  maxGapMinutes = Infinity,
): Suggestion[] {
  const sorted = [...visits].sort((a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute)
  const sessions: { date: string; arrival: number; departure: number; placeId: string; longest: number }[] = []
  for (const v of sorted) {
    const last = sessions.at(-1)
    const length = v.endMinute - v.startMinute
    if (last && last.date === v.date && v.startMinute - last.departure <= maxGapMinutes) {
      last.departure = Math.max(last.departure, v.endMinute)
      if (length > last.longest) Object.assign(last, { placeId: v.placeId, longest: length })
    } else {
      sessions.push({ date: v.date, arrival: v.startMinute, departure: v.endMinute, placeId: v.placeId, longest: length })
    }
  }

  const up = (m: number) => Math.ceil(m / roundTo) * roundTo
  const result: Suggestion[] = []
  for (const s of sessions) {
    const arrival = up(s.arrival)
    const departure = up(s.departure)
    const add = (start: number, end: number) => {
      if (end - start >= minMinutes)
        result.push({ key: `${s.date}-${start}`, date: s.date, start, end, placeId: s.placeId, arrival: s.arrival, departure: s.departure })
    }
    if (isOffDay(s.date)) {
      add(arrival, departure)
    } else {
      add(arrival, Math.min(departure, DAY_START))
      add(Math.max(arrival, DAY_END), departure)
    }
  }
  return result
}
