// Relative URLs so the app works under an IIS sub-application (e.g. /otportal/).
const BASE = 'api'

export type DayType = 'Weekday' | 'Weekend' | 'Holiday'
export type TimeWindow = 'Morning' | 'Day' | 'Evening'

export interface Employee {
  id: number
  nameEn: string
  nameTh: string
  defaultBreakMinutes: number
}

export interface Segment {
  date: string
  dayType: DayType
  window: TimeWindow
  startMinute: number
  endMinute: number
  breakMinutes: number
  rate: number
  grossMinutes: number
  netMinutes: number
  weightedMinutes: number
  isPaid: boolean
}

export interface OtResult {
  segments: Segment[]
  warnings: string[]
  hasOt: boolean
}

export interface EntryInput {
  employeeId: number
  date: string // yyyy-MM-dd
  start: string // HH:mm
  end: string
  breakMinutes: number
  support: boolean
  project: string
  remark: string
}

export interface Entry extends Omit<EntryInput, 'employeeId' | 'project' | 'remark'> {
  id: number
  project: string | null
  remark: string | null
  result: OtResult
}

/** A Google Timeline place the employee named; matched again by place id or within 100 m. */
export interface SavedPlace {
  id: number
  placeId: string | null
  lat: number
  lng: number
  name: string | null
  project: string | null
  address: string | null
}

export interface PlaceInput {
  employeeId: number
  placeId: string
  lat: number
  lng: number
  name: string
  project: string
  address: string
}

export interface Holiday {
  date: string
  name: string
}

export interface Report {
  fileName: string
  totals: { ot10: number; ot15: number; ot30: number; otxTime: number }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    let message = text
    try {
      const body = JSON.parse(text)
      message = body.detail ?? body.title ?? text
    } catch {
      /* plain text */
    }
    throw new Error(message || res.statusText)
  }
  if (res.status === 204) return undefined as T
  if (!res.headers.get('content-type')?.includes('json'))
    throw new Error(`API ${path} ไม่ได้ตอบเป็น JSON (API อาจเป็นเวอร์ชันเก่า ลองรีสตาร์ท)`)
  return res.json()
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })

export const api = {
  employees: () => request<Employee[]>('employees'),
  saveEmployee: (e: Omit<Employee, 'id'>, id?: number) =>
    request<Employee>(id ? `employees/${id}` : 'employees', json(id ? 'PUT' : 'POST', e)),

  holidays: (year: number) => request<Holiday[]>(`holidays?year=${year}`),
  saveHolidays: (items: Holiday[]) => request<void>('holidays', json('POST', items)),
  deleteHoliday: (date: string) => request<void>(`holidays/${date}`, { method: 'DELETE' }),

  entries: (employeeId: number, month: string) => request<Entry[]>(`entries?employeeId=${employeeId}&month=${month}`),
  preview: (e: EntryInput) => request<OtResult>('preview', json('POST', e)),
  saveEntry: (e: EntryInput, id?: number) => request<Entry>(id ? `entries/${id}` : 'entries', json(id ? 'PUT' : 'POST', e)),
  deleteEntry: (id: number) => request<void>(`entries/${id}`, { method: 'DELETE' }),

  places: (employeeId: number) => request<SavedPlace[]>(`places?employeeId=${employeeId}`),
  /** Upsert; returns undefined when every field was cleared (the place is deleted). */
  savePlace: (p: PlaceInput) => request<SavedPlace | undefined>('places', json('PUT', p)),

  report: (employeeId: number, month: string) => request<Report>(`report?employeeId=${employeeId}&month=${month}`),
  exportUrl: (employeeId: number, month: string) => `${BASE}/export?employeeId=${employeeId}&month=${month}`,
}

// ---------- formatting ----------
export const hhmm = (minutes: number) =>
  minutes >= 1440 ? '24:00' : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

export const duration = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`

export const toIsoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const shortTime = (t: string) => t.slice(0, 5)

const LUNCH_START = '12:00'
const LUNCH_END = '13:00'

/** Default break = profile break when the range covers lunch (12:00-13:00), else 0. */
export const autoBreak = (start: string, end: string, profileBreak: number) =>
  start <= LUNCH_START && (end >= LUNCH_END || end <= start) ? profileBreak : 0

// ---------- OT period ----------
/** OT period "yyyy-MM" runs from the 21st of the previous month to the 20th of that month (same as the API). */
export const CUTOFF_DAY = 20

export function periodOf(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return toIsoDate(new Date(y, m - 1 + (d > CUTOFF_DAY ? 1 : 0), 1)).slice(0, 7)
}

export function periodRange(month: string) {
  const [y, m] = month.split('-').map(Number)
  return { from: toIsoDate(new Date(y, m - 2, CUTOFF_DAY + 1)), to: toIsoDate(new Date(y, m - 1, CUTOFF_DAY)) }
}

const thMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
export const thShortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${thMonths[Number(iso.slice(5, 7)) - 1]}`

const thDays = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']
export const thDay = (iso: string) => thDays[new Date(iso + 'T00:00:00').getDay()]

export const dayTypeLabel: Record<DayType, string> = {
  Weekday: 'วันทำงาน',
  Weekend: 'เสาร์-อาทิตย์',
  Holiday: 'วันหยุดนักขัตฤกษ์',
}
