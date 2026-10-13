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
  remark: string
}

export interface Entry extends Omit<EntryInput, 'employeeId' | 'remark'> {
  id: number
  remark: string | null
  result: OtResult
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
  return res.status === 204 ? (undefined as T) : res.json()
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

const thDays = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']
export const thDay = (iso: string) => thDays[new Date(iso + 'T00:00:00').getDay()]

export const dayTypeLabel: Record<DayType, string> = {
  Weekday: 'วันทำงาน',
  Weekend: 'เสาร์-อาทิตย์',
  Holiday: 'วันหยุดนักขัตฤกษ์',
}
