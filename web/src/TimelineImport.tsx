import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import TimeInput from './TimeInput'
import { matchPlace, reverseGeocode, type PlaceInfo } from './geocode'
import { api, autoBreak, hhmm, periodRange, shortTime, thDay, toIsoDate, type Employee, type Entry, type SavedPlace } from './api'
import { parseTimeline, placesBetween, suggest, type Place, type Suggestion, type Timeline, type Visit } from './timeline'

interface Props {
  employee: Employee
  month: string
  entries: Entry[]
  onImported: () => void
  onClose: () => void
}

/** Name / project / address of a timeline place, from the employee's saved places (API). */
interface PlaceChoice {
  name: string
  project: string
  address: string
}

type PlaceField = 'name' | 'project'

/** Earlier versions kept names in the browser; they are moved to the API once, then removed. */
const LEGACY_PLACES_KEY = 'otportal.timelinePlaces'

function takeLegacyChoices(): Record<string, { name?: string; project?: string; osm?: PlaceInfo }> {
  try {
    return JSON.parse(localStorage.getItem(LEGACY_PLACES_KEY) ?? '{}')
  } catch {
    return {}
  }
}

const placeLabel = (p: Place, index: number) =>
  p.semanticType.includes('WORK') ? `ที่ทำงาน #${index + 1} (Google เดา)` : p.semanticType.includes('HOME') ? 'บ้าน' : `สถานที่ #${index + 1}`

/** Visits shorter than this are hidden from the day list (passing by, traffic...). */
const MIN_VISIT_MINUTES = 10

/** The part of a visit that falls on one day (minutes from that day's midnight), ticked on its own. */
interface DayPart extends Visit {
  fromPrevDay: boolean
}

const addDays = (iso: string, days: number) => {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return toIsoDate(d)
}

interface Row {
  selected: boolean
  start: string
  end: string
  project: string
  remark: string
  conflict: boolean
  /** The suggested range the times came from; when the ticks change it, the times follow. */
  source: string
}

export default function TimelineImport({ employee, month, entries, onImported, onClose }: Props) {
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [saved, setSaved] = useState<SavedPlace[]>([])
  const [drafts, setDrafts] = useState<Record<string, Partial<Record<PlaceField, string>>>>({})
  const [holidays, setHolidays] = useState<Set<string>>(new Set())
  const [roundTo, setRoundTo] = useState(30)
  const [minMinutes, setMinMinutes] = useState(30)
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)

  const range = periodRange(month)

  useEffect(() => {
    api.places().then(setSaved).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    const years = [...new Set([range.from.slice(0, 4), range.to.slice(0, 4)])].map(Number)
    Promise.all(years.map((y) => api.holidays(y)))
      .then((lists) => setHolidays(new Set(lists.flat().map((h) => h.date))))
      .catch((e) => setError(e.message))
  }, [range.from, range.to])

  // Per-day ticks for this session only.
  const [visitWork, setVisitWork] = useState<Record<string, boolean>>({})

  // Nothing is ticked until the user ticks it.
  const isVisitWork = (v: Visit) => visitWork[v.key] ?? false
  const [periodOnly, setPeriodOnly] = useState(true)
  const places = useMemo(
    () => (!timeline ? [] : (periodOnly ? placesBetween(timeline, range.from, range.to) : timeline.places).slice(0, 10)),
    [timeline, periodOnly, range.from, range.to],
  )
  const rank = useMemo(() => new Map(timeline?.places.map((p, i) => [p.id, i]) ?? []), [timeline])
  const placeById = useMemo(() => new Map(timeline?.places.map((p) => [p.id, p]) ?? []), [timeline])
  // Every timeline place gets the name / project of the saved place with the same id or within 100 m.
  const choices = useMemo(() => {
    const result: Record<string, PlaceChoice> = {}
    for (const p of timeline?.places ?? []) {
      const s = matchPlace(saved, p.id, p.lat, p.lng)
      if (s) result[p.id] = { name: s.name ?? '', project: s.project ?? '', address: s.address ?? '' }
    }
    return result
  }, [timeline, saved])

  const placeName = (id: string) => {
    const place = placeById.get(id)
    return choices[id]?.name || (place ? placeLabel(place, rank.get(id) ?? 0) : '')
  }

  // A visit is cut at midnight into one part per day, so each day is ticked on its own
  // (e.g. home from Sat 16:00 to Mon 12:00 → Sat 16:00-24:00, Sun 00:00-24:00, Mon 00:00-12:00).
  const parts = useMemo(() => {
    const result: DayPart[] = []
    for (const visit of timeline?.visits ?? []) {
      for (let day = 0; day * 1440 < visit.endMinute; day++) {
        const date = addDays(visit.date, day)
        if (date < range.from || date > range.to) continue
        result.push({
          key: `${visit.key}@${date}`,
          placeId: visit.placeId,
          date,
          startMinute: Math.max(visit.startMinute - day * 1440, 0),
          endMinute: Math.min(visit.endMinute - day * 1440, 1440),
          fromPrevDay: day > 0,
        })
      }
    }
    return result
  }, [timeline, range.from, range.to])

  const days = useMemo(() => {
    const byDate = new Map<string, DayPart[]>()
    for (const p of parts) {
      if (p.endMinute - p.startMinute >= MIN_VISIT_MINUTES) byDate.set(p.date, [...(byDate.get(p.date) ?? []), p])
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, visits]) => ({ date, visits: visits.sort((a, b) => a.startMinute - b.startMinute) }))
  }, [parts])

  const isOffDay = (d: string) => holidays.has(d) || [0, 6].includes(new Date(d + 'T00:00:00').getDay())

  const suggestions = useMemo(
    () => suggest(parts.filter(isVisitWork), isOffDay, roundTo, minMinutes),
    [parts, visitWork, choices, holidays, roundTo, minMinutes],
  )

  const setVisits = (visits: Visit[], work: boolean) =>
    setVisitWork((prev) => ({ ...prev, ...Object.fromEntries(visits.map((v) => [v.key, work])) }))

  const listedVisits = useMemo(() => days.flatMap((d) => d.visits), [days])
  const listedWork = listedVisits.filter(isVisitWork).length

  // (Re)build editable rows whenever the suggestions change. Project / remark / tick are kept;
  // times are kept only while the suggested range is unchanged (else they follow the new ticks).
  useEffect(() => {
    setRows((prev) => {
      const next: Record<string, Row> = {}
      for (const s of suggestions) {
        const conflict = entries.some((e) => e.date === s.date && overlaps(e, s))
        const source = `${s.start}-${s.end}`
        const old = prev[s.key]
        const times = { start: hhmm(s.start), end: hhmm(s.end % 1440), source }
        next[s.key] = !old
          ? { selected: !conflict, project: choices[s.placeId]?.project ?? '', remark: '', conflict, ...times }
          : old.source === source
            ? old
            : { ...old, ...times }
      }
      return next
    })
  }, [suggestions, entries])

  const loadFile = async (file: File) => {
    setError('')
    try {
      setTimeline(parseTimeline(await file.text()))
    } catch (e) {
      setTimeline(null)
      setError((e as Error).message)
    }
  }

  /** Saves a place (with its coordinates) so the name is found again next time, even under another place id. */
  const savePlace = async (p: Place, change: Partial<PlaceChoice>, current = choices[p.id]) => {
    if (p.lat === null || p.lng === null) return
    const body = { name: current?.name ?? '', project: current?.project ?? '', address: current?.address ?? '', ...change }
    const result = await api.savePlace({ placeId: p.id, lat: p.lat, lng: p.lng, ...body })
    setSaved((prev) => {
      const old = matchPlace(prev, p.id, p.lat, p.lng)
      const rest = prev.filter((s) => s !== old)
      return result ? [...rest, result] : rest
    })
  }

  const fieldValue = (p: Place, field: PlaceField) => drafts[p.id]?.[field] ?? choices[p.id]?.[field] ?? ''
  const editField = (p: Place, field: PlaceField, value: string) =>
    setDrafts((d) => ({ ...d, [p.id]: { ...d[p.id], [field]: value } }))
  const commitField = (p: Place, field: PlaceField) => {
    const value = drafts[p.id]?.[field]
    if (value === undefined || value === (choices[p.id]?.[field] ?? '')) return
    savePlace(p, { [field]: value })
      .then(() => setDrafts((d) => ({ ...d, [p.id]: { ...d[p.id], [field]: undefined } })))
      .catch((e) => setError(`บันทึกสถานที่ไม่สำเร็จ: ${e.message}`))
  }

  // One-time move of names typed in earlier versions (browser only) into the database.
  const migrated = useRef(false)
  useEffect(() => {
    if (!timeline || migrated.current) return
    migrated.current = true
    const legacy = takeLegacyChoices()
    const moves = timeline.places
      .filter((p) => legacy[p.id] && !choices[p.id])
      .map((p) => {
        const l = legacy[p.id]
        return savePlace(p, { name: l.name || l.osm?.name || '', project: l.project ?? '', address: l.osm?.address ?? '' }, undefined)
      })
    Promise.all(moves)
      .then(() => localStorage.removeItem(LEGACY_PLACES_KEY))
      .catch(() => {
        /* keep the browser copy and try again next time */
      })
  }, [timeline])

  // Places seen in this period, except home and those that already have an address.
  const toLookUp = timeline
    ? placesBetween(timeline, range.from, range.to).filter((p) => p.lat !== null && !p.semanticType.includes('HOME') && !choices[p.id]?.address)
    : []

  const lookUpNames = async () => {
    setLookingUp(true)
    setError('')
    try {
      for (const p of toLookUp) {
        const osm = await reverseGeocode(p.lat!, p.lng!)
        await savePlace(p, { name: choices[p.id]?.name || osm.name, address: osm.address })
      }
    } catch (e) {
      setError(`ค้นหาชื่อไม่สำเร็จ: ${(e as Error).message}`)
    } finally {
      setLookingUp(false)
    }
  }

  const updateRow = (key: string, change: Partial<Row>) => setRows((r) => ({ ...r, [key]: { ...r[key], ...change } }))

  const selected = suggestions.filter((s) => rows[s.key]?.selected && validRange(rows[s.key], s))
  const invalidSelected = suggestions.filter((s) => rows[s.key]?.selected && !validRange(rows[s.key], s)).length
  // "Select all" skips rows that already have an entry, so it never creates duplicates.
  const selectable = suggestions.filter((s) => rows[s.key] && !rows[s.key].conflict)
  const allSelected = selectable.length > 0 && selectable.every((s) => rows[s.key].selected)
  const someSelected = selected.length > 0 && !allSelected
  const selectAll = (value: boolean) =>
    setRows((r) => {
      const next = { ...r }
      for (const s of selectable) next[s.key] = { ...next[s.key], selected: value }
      return next
    })

  const save = async () => {
    setSaving(true)
    setError('')
    const failed: string[] = []
    for (const s of selected) {
      const r = rows[s.key]
      try {
        await api.saveEntry({
          date: s.date,
          start: r.start,
          end: r.end,
          breakMinutes: autoBreak(r.start, r.end, employee.defaultBreakMinutes),
          support: false,
          project: r.project,
          remark: r.remark,
        })
        updateRow(s.key, { selected: false, conflict: true })
      } catch (e) {
        failed.push(`${s.date} ${r.start}-${r.end}: ${(e as Error).message}`)
      }
    }
    setSaving(false)
    if (failed.length) setError(`บันทึกไม่สำเร็จ ${failed.length} รายการ\n${failed.join('\n')}`)
    onImported()
  }

  return (
    <section className="card timeline">
      <div className="card-title">
        นำเข้าจาก Google Timeline
        <span className="muted">อ่านไฟล์ในเครื่องเท่านั้น ไม่ส่งตำแหน่งขึ้น server</span>
        <button className="ghost small close" onClick={onClose}>
          ปิด
        </button>
      </div>

      <label>
        ไฟล์ Timeline.json (Google Maps บนมือถือ → Timeline → Export)
        <input type="file" accept=".json,application/json" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
      </label>

      {error && <div className="alert pre">{error}</div>}

      {timeline && (
        <>
          <h3>
            1. เลือกช่วงที่อยู่ที่ทำงาน (รายวัน)
            {toLookUp.length > 0 && (
              <button
                className="ghost small"
                disabled={lookingUp}
                onClick={lookUpNames}
                title="ส่งพิกัดของสถานที่ที่ไปในรอบนี้ (ยกเว้นบ้าน) ไปหาชื่อที่ OpenStreetMap"
              >
                {lookingUp ? 'กำลังค้นหา...' : `🔎 ค้นหาชื่อจาก OpenStreetMap (${toLookUp.length} ที่)`}
              </button>
            )}
          </h3>
          {days.length === 0 ? (
            <p className="muted empty">ไม่มีข้อมูลสถานที่ในรอบนี้</p>
          ) : (
            <div className="table-wrap day-list">
              <table>
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        title="เลือกทั้งหมด"
                        checked={listedWork === listedVisits.length}
                        ref={(el) => {
                          if (el) el.indeterminate = listedWork > 0 && listedWork < listedVisits.length
                        }}
                        onChange={(e) => setVisits(listedVisits, e.target.checked)}
                      />
                    </th>
                    <th>เวลา</th>
                    <th>สถานที่</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => {
                    const worked = d.visits.filter(isVisitWork).length
                    return (
                      <Fragment key={d.date}>
                        <tr className="day-row">
                          <td>
                            <input
                              type="checkbox"
                              title="ทั้งวัน"
                              checked={worked === d.visits.length}
                              ref={(el) => {
                                if (el) el.indeterminate = worked > 0 && worked < d.visits.length
                              }}
                              onChange={(e) => setVisits(d.visits, e.target.checked)}
                            />
                          </td>
                          <td colSpan={3}>
                            {thDay(d.date)} {d.date.slice(8, 10)}/{d.date.slice(5, 7)}
                            {holidays.has(d.date) ? (
                              <span className="badge holiday">หยุด</span>
                            ) : (
                              isOffDay(d.date) && <span className="badge weekend">เสาร์-อาทิตย์</span>
                            )}
                          </td>
                        </tr>
                        {d.visits.map((v) => {
                          const place = placeById.get(v.placeId)
                          return (
                            <tr key={v.key} className={isVisitWork(v) ? 'visit work' : 'visit'}>
                              <td>
                                <input type="checkbox" checked={isVisitWork(v)} onChange={(e) => setVisits([v], e.target.checked)} />
                              </td>
                              <td className="visit-time" title={v.fromPrevDay ? 'ต่อจากเมื่อวาน' : undefined}>
                                {/* A day ends at 00:00 and the next one starts at 00:01. */}
                                {v.fromPrevDay ? '00:01' : hhmm(v.startMinute)}–{v.endMinute === 1440 ? '00:00' : hhmm(v.endMinute)}
                              </td>
                              <td>
                                {placeName(v.placeId)}
                                {choices[v.placeId]?.address && <small className="muted"> · {choices[v.placeId].address}</small>}
                              </td>
                              <td>
                                {place?.lat != null && (
                                  <a href={`https://www.google.com/maps?q=${place.lat},${place.lng}`} target="_blank" rel="noreferrer">
                                    แผนที่
                                  </a>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <details className="place-settings">
            <summary>ตั้งชื่อ / Project ของสถานที่</summary>
            <label className="check">
              <input type="checkbox" checked={periodOnly} onChange={(e) => setPeriodOnly(e.target.checked)} />
              เฉพาะสถานที่ที่ไปในรอบนี้ ({range.from} ถึง {range.to})
            </label>
            {places.length === 0 ? (
              <p className="muted empty">ไม่มีข้อมูลสถานที่ในรอบนี้</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>สถานที่</th>
                      <th>มักอยู่ช่วง</th>
                      <th className="num">ชม.</th>
                      <th className="num">ครั้ง</th>
                      <th>Project</th>
                    </tr>
                  </thead>
                  <tbody>
                    {places.map((p, i) => (
                      <tr key={p.id}>
                        <td className="place-cell">
                          <div className="place-name">
                            <input
                              value={fieldValue(p, 'name')}
                              onChange={(e) => editField(p, 'name', e.target.value)}
                              onBlur={() => commitField(p, 'name')}
                              placeholder={placeLabel(p, i)}
                              disabled={p.lat === null}
                              title="ตั้งชื่อเอง (บันทึกเมื่อออกจากช่อง)"
                            />
                            {p.lat !== null && (
                              <a href={`https://www.google.com/maps?q=${p.lat},${p.lng}`} target="_blank" rel="noreferrer">
                                แผนที่
                              </a>
                            )}
                          </div>
                          {choices[p.id]?.address && <small className="muted">{choices[p.id].address}</small>}
                        </td>
                        <td>
                          {hhmm(p.typicalArrival)}–{hhmm(p.typicalDeparture)}
                        </td>
                        <td className="num">{Math.round(p.hours)}</td>
                        <td className="num">{p.visits}</td>
                        <td>
                          <input
                            value={fieldValue(p, 'project')}
                            onChange={(e) => editField(p, 'project', e.target.value)}
                            onBlur={() => commitField(p, 'project')}
                            placeholder="Project ของที่นี่"
                            disabled={p.lat === null}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>

          <h3>
            2. รายการ OT ที่แนะนำ <span className="muted">({range.from} ถึง {range.to})</span>
          </h3>
          <div className="chips">
            <label className="inline">
              ปัดเวลา
              <select value={roundTo} onChange={(e) => setRoundTo(Number(e.target.value))}>
                {[1, 5, 15, 30].map((m) => (
                  <option key={m} value={m}>
                    {m} นาที
                  </option>
                ))}
              </select>
            </label>
            <label className="inline">
              ขั้นต่ำ
              <select value={minMinutes} onChange={(e) => setMinMinutes(Number(e.target.value))}>
                {[15, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} นาที
                  </option>
                ))}
              </select>
            </label>
          </div>

          {timeline.to < range.from || timeline.from > range.to ? (
            <p className="muted empty">
              ไฟล์มีข้อมูล {timeline.from} ถึง {timeline.to} ไม่ตรงกับรอบนี้
            </p>
          ) : suggestions.length === 0 ? (
            <p className="muted empty">ไม่พบช่วงเวลานอกเวลางานในรอบนี้</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        title="เลือกทั้งหมด (ยกเว้นวันที่มีรายการแล้ว)"
                        checked={allSelected}
                        disabled={selectable.length === 0}
                        ref={(el) => {
                          if (el) el.indeterminate = someSelected
                        }}
                        onChange={(e) => selectAll(e.target.checked)}
                      />
                    </th>
                    <th>วันที่</th>
                    <th>อยู่ที่ทำงาน</th>
                    <th>OT</th>
                    <th>Project</th>
                    <th>รายละเอียด</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((s) => {
                    const r = rows[s.key]
                    if (!r) return null
                    return (
                      <tr key={s.key} className={r.conflict ? 'muted' : ''}>
                        <td>
                          <input type="checkbox" checked={r.selected} onChange={(e) => updateRow(s.key, { selected: e.target.checked })} />
                        </td>
                        <td>
                          {thDay(s.date)} {s.date.slice(8, 10)}/{s.date.slice(5, 7)}
                          {holidays.has(s.date) && <span className="badge holiday">หยุด</span>}
                          {r.conflict && <span className="badge">มีแล้ว</span>}
                        </td>
                        <td className="muted">
                          {hhmm(s.arrival)}–{hhmm(s.departure % 1440)}
                        </td>
                        <td className="time-pair">
                          <TimeInput value={r.start} onChange={(start) => updateRow(s.key, { start })} invalid={!validRange(r, s)} />
                          <TimeInput
                            value={r.end}
                            onChange={(end) => updateRow(s.key, { end })}
                            invalid={!validRange(r, s)}
                            title={s.end > 1440 ? 'ข้ามเที่ยงคืนได้ (ออกวันถัดไป)' : 'ต้องหลังเวลาเริ่ม'}
                          />
                        </td>
                        <td>
                          <input value={r.project} onChange={(e) => updateRow(s.key, { project: e.target.value })} />
                        </td>
                        <td>
                          <input value={r.remark} onChange={(e) => updateRow(s.key, { remark: e.target.value })} placeholder="ทำอะไร" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="actions">
            {invalidSelected > 0 && <span className="warn-text">{invalidSelected} รายการเวลาสิ้นสุดไม่หลังเวลาเริ่ม จะไม่ถูกบันทึก</span>}
            <button disabled={saving || selected.length === 0} onClick={save}>
              {saving ? 'กำลังบันทึก...' : `บันทึก ${selected.length} รายการ`}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/** End must be after start; only a suggestion that really ran past midnight may end "earlier" (next day). */
function validRange(r: { start: string; end: string }, s: Suggestion) {
  const start = toMin(r.start)
  const end = toMin(r.end)
  return end > start || (s.end > 1440 && end < start)
}

function overlaps(e: Entry, s: Suggestion) {
  const start = toMin(shortTime(e.start))
  let end = toMin(shortTime(e.end))
  if (end <= start) end += 1440
  return start < s.end && s.start < end
}
