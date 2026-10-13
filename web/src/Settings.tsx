import { useEffect, useState } from 'react'
import { api, type Employee, type Holiday } from './api'

interface Props {
  employee: Employee | null
  employees: Employee[]
  onSelect: (id: number) => void
  onSaved: (e: Employee) => void
  onClose?: () => void
}

export default function Settings({ employee, employees, onSelect, onSaved, onClose }: Props) {
  return (
    <div className="settings">
      <header className="topbar">
        <h1>{employee ? 'ตั้งค่า' : 'OT Portal — เริ่มต้นใช้งาน'}</h1>
        {onClose && (
          <button className="ghost" onClick={onClose}>
            ← กลับ
          </button>
        )}
      </header>
      {employees.length > 0 && (
        <section className="card">
          <div className="card-title">เลือกพนักงาน</div>
          <div className="chips">
            {employees.map((e) => (
              <button key={e.id} className={`chip ${e.id === employee?.id ? 'active' : ''}`} onClick={() => onSelect(e.id)}>
                {e.nameTh} ({e.nameEn})
              </button>
            ))}
          </div>
        </section>
      )}
      <ProfileForm key={employee?.id ?? 'new'} employee={employee} onSaved={onSaved} />
      {employee && <ProfileForm key="add" employee={null} onSaved={onSaved} collapsed />}
      <Holidays />
    </div>
  )
}

function ProfileForm({ employee, onSaved, collapsed }: { employee: Employee | null; onSaved: (e: Employee) => void; collapsed?: boolean }) {
  const [open, setOpen] = useState(!collapsed)
  const [nameTh, setNameTh] = useState(employee?.nameTh ?? '')
  const [nameEn, setNameEn] = useState(employee?.nameEn ?? '')
  const [breakMin, setBreakMin] = useState(employee?.defaultBreakMinutes ?? 60)
  const [error, setError] = useState('')

  if (!open)
    return (
      <button className="ghost add-employee" onClick={() => setOpen(true)}>
        + เพิ่มพนักงานคนอื่น
      </button>
    )

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      onSaved(await api.saveEmployee({ nameTh, nameEn, defaultBreakMinutes: breakMin }, employee?.id))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form className="card" onSubmit={save}>
      <div className="card-title">{employee ? 'ข้อมูลของฉัน' : 'เพิ่มพนักงาน'}</div>
      <div className="form-grid">
        <label>
          ชื่อ-นามสกุล (ไทย)
          <input value={nameTh} onChange={(e) => setNameTh(e.target.value)} required />
        </label>
        <label>
          ชื่อ EN (ใช้ตั้งชื่อไฟล์)
          <input
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value.toUpperCase())}
            pattern="[A-Za-z0-9 ]+"
            placeholder="JENWIT"
            required
          />
        </label>
        <label>
          พักกลางวัน (นาที)
          <input type="number" min={0} step={5} value={breakMin} onChange={(e) => setBreakMin(Number(e.target.value))} />
        </label>
      </div>
      <p className="muted">
        ไฟล์ Export: <b>OT_YYMM_{nameEn.replace(/[^A-Za-z0-9]/g, '') || 'NAME'}.xlsx</b> · หักเวลาพักอัตโนมัติเมื่อช่วงเวลาครอบ 12:00–13:00
      </p>
      {error && <div className="alert">{error}</div>}
      <div className="actions">
        <button type="submit">บันทึก</button>
      </div>
    </form>
  )
}

function Holidays() {
  const [year, setYear] = useState(new Date().getFullYear())
  const [items, setItems] = useState<Holiday[]>([])
  const [bulk, setBulk] = useState('')
  const [error, setError] = useState('')

  const load = () => api.holidays(year).then(setItems).catch((e) => setError(e.message))
  useEffect(() => {
    load()
  }, [year])

  // Accepts one per line: "2026-12-05 วันพ่อ" or "05/12/2026 วันพ่อ"
  const parse = (text: string): Holiday[] =>
    text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^(\d{4})-(\d{2})-(\d{2})\s*(.*)$/) ?? line.match(/^(\d{2})\/(\d{2})\/(\d{4})\s*(.*)$/)
        if (!m) throw new Error(`อ่านบรรทัดไม่ได้: ${line}`)
        const [y, mo, d] = line.includes('/') ? [m[3], m[2], m[1]] : [m[1], m[2], m[3]]
        return { date: `${y}-${mo}-${d}`, name: m[4] || 'วันหยุด' }
      })

  const add = async () => {
    try {
      await api.saveHolidays(parse(bulk))
      setBulk('')
      setError('')
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <section className="card">
      <div className="card-title">
        วันหยุดนักขัตฤกษ์ (ใช้ร่วมกันทุกคน)
        <input type="number" className="year" value={year} onChange={(e) => setYear(Number(e.target.value))} />
      </div>
      {items.length === 0 ? (
        <p className="muted">ยังไม่มีวันหยุดของปีนี้</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>วันเดือนปี</th>
                <th>ชื่อวันหยุด</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((h) => (
                <tr key={h.date}>
                  <td className="nowrap">
                    {h.date.slice(8, 10)}/{h.date.slice(5, 7)}/{h.date.slice(0, 4)}
                  </td>
                  <td>{h.name}</td>
                  <td className="row-actions">
                    <button className="ghost small danger" onClick={() => api.deleteHoliday(h.date).then(load)}>
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <textarea
        rows={3}
        value={bulk}
        onChange={(e) => setBulk(e.target.value)}
        placeholder={'วางได้หลายบรรทัด เช่น\n2026-12-05 วันพ่อแห่งชาติ\n10/12/2026 วันรัฐธรรมนูญ'}
      />
      {error && <div className="alert">{error}</div>}
      <div className="actions">
        <button onClick={add} disabled={!bulk.trim()}>
          เพิ่มวันหยุด
        </button>
      </div>
    </section>
  )
}
