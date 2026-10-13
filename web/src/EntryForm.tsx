import { useEffect, useMemo, useState } from 'react'
import {
  api,
  dayTypeLabel,
  duration,
  hhmm,
  shortTime,
  thDay,
  toIsoDate,
  type Employee,
  type Entry,
  type EntryInput,
  type OtResult,
} from './api'

interface Props {
  employee: Employee
  month: string
  editing: Entry | null
  recent: Entry[]
  onSaved: (date: string) => void
  onCancel: () => void
}

const LUNCH_START = '12:00'
const LUNCH_END = '13:00'

/** Default break = profile break when the range covers lunch (12:00-13:00), else 0. */
const autoBreak = (start: string, end: string, profileBreak: number) =>
  start <= LUNCH_START && (end >= LUNCH_END || end <= start) ? profileBreak : 0

function defaultDate(month: string, recent: Entry[]) {
  const today = toIsoDate(new Date())
  if (today.startsWith(month)) return today
  return recent.at(-1)?.date ?? `${month}-01`
}

function recentRanges(recent: Entry[]) {
  const seen = new Set<string>()
  const ranges: { start: string; end: string }[] = []
  for (const e of [...recent].reverse()) {
    const key = `${shortTime(e.start)}-${shortTime(e.end)}`
    if (seen.has(key)) continue
    seen.add(key)
    ranges.push({ start: shortTime(e.start), end: shortTime(e.end) })
    if (ranges.length === 4) break
  }
  for (const preset of [
    { start: '18:00', end: '21:00' },
    { start: '08:30', end: '18:00' },
  ]) {
    if (ranges.length < 5 && !seen.has(`${preset.start}-${preset.end}`)) ranges.push(preset)
  }
  return ranges
}

export default function EntryForm({ employee, month, editing, recent, onSaved, onCancel }: Props) {
  const last = recent.at(-1)
  const [date, setDate] = useState(editing?.date ?? defaultDate(month, recent))
  const [start, setStart] = useState(shortTime(editing?.start ?? last?.start ?? '18:00'))
  const [end, setEnd] = useState(shortTime(editing?.end ?? last?.end ?? '21:00'))
  const [breakMinutes, setBreakMinutes] = useState<number | null>(editing ? editing.breakMinutes : null) // null = auto
  const [support, setSupport] = useState(editing?.support ?? false)
  const [remark, setRemark] = useState(editing?.remark ?? '')
  const [preview, setPreview] = useState<OtResult | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const effectiveBreak = breakMinutes ?? autoBreak(start, end, employee.defaultBreakMinutes)
  const ranges = useMemo(() => recentRanges(recent), [recent])

  const input: EntryInput = { employeeId: employee.id, date, start, end, breakMinutes: effectiveBreak, support, remark }

  useEffect(() => {
    if (!date || !start || !end) return
    const t = setTimeout(() => {
      api
        .preview(input)
        .then((r) => {
          setPreview(r)
          setError('')
        })
        .catch((e) => setError(e.message))
    }, 200)
    return () => clearTimeout(t)
  }, [date, start, end, effectiveBreak, support])

  const supportApplies = preview?.segments.some((s) => s.dayType === 'Weekend' && s.window === 'Day') ?? false
  const firstDayType = preview?.segments[0]?.dayType

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.saveEntry({ ...input, support: support && supportApplies }, editing?.id)
      setRemark('')
      onSaved(date)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="card entry-form" onSubmit={save}>
      <div className="card-title">
        {editing ? 'แก้ไขรายการ' : 'บันทึก OT'}
        {firstDayType && <span className={`badge ${firstDayType.toLowerCase()}`}>{dayTypeLabel[firstDayType]}</span>}
      </div>

      <div className="form-grid">
        <label>
          วันที่ <small>({date && thDay(date)})</small>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          เริ่ม
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label>
          ถึง
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </label>
        <label>
          พัก (นาที) {breakMinutes === null && <small>อัตโนมัติ</small>}
          <input
            type="number"
            min={0}
            step={5}
            value={effectiveBreak}
            onChange={(e) => setBreakMinutes(e.target.value === '' ? null : Math.max(0, Number(e.target.value)))}
          />
        </label>
        <label className="remark">
          หมายเหตุ
          <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="เช่น Go-live WMS ลูกค้า X" />
        </label>
      </div>

      <div className="chips">
        {ranges.map((r) => (
          <button
            type="button"
            key={`${r.start}-${r.end}`}
            className={`chip ${r.start === start && r.end === end ? 'active' : ''}`}
            onClick={() => {
              setStart(r.start)
              setEnd(r.end)
            }}
          >
            {r.start}–{r.end}
          </button>
        ))}
        <label className={`check ${supportApplies ? '' : 'disabled'}`} title="ใช้ได้เฉพาะเสาร์-อาทิตย์ 08:30-18:00">
          <input type="checkbox" checked={support} disabled={!supportApplies} onChange={(e) => setSupport(e.target.checked)} />
          Support (1.5)
        </label>
      </div>

      {preview && (
        <div className="preview">
          {preview.segments.map((s, i) => (
            <span key={i} className={`seg ${s.isPaid ? `rate-${String(s.rate).replace('.', '')}` : 'none'}`}>
              {s.date !== date && `${thDay(s.date)} `}
              {hhmm(s.startMinute)}–{hhmm(s.endMinute)} {s.isPaid ? `OT ${s.rate.toFixed(1)} × ${duration(s.netMinutes)}` : 'ไม่นับ'}
              {s.breakMinutes > 0 && ` (พัก ${s.breakMinutes})`}
            </span>
          ))}
          {preview.warnings.map((w) => (
            <div key={w} className="warn">
              {w}
            </div>
          ))}
        </div>
      )}

      {error && <div className="alert">{error}</div>}

      <div className="actions">
        {editing && (
          <button type="button" className="ghost" onClick={onCancel}>
            ยกเลิก
          </button>
        )}
        <button type="submit" disabled={saving || !preview?.hasOt}>
          {editing ? 'บันทึกการแก้ไข' : 'เพิ่ม'} ↵
        </button>
      </div>
    </form>
  )
}
