import { useEffect, useState } from 'react'
import { api, type Employee, type Holiday, type Profile } from './api'

interface Props {
  employee: Employee
  onSaved: (e: Employee) => void
  onClose: () => void
}

export default function Settings({ employee, onSaved, onClose }: Props) {
  const [profile, setProfile] = useState<Profile>(employee)
  const [error, setError] = useState('')

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      onSaved(await api.saveProfile(profile))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="settings">
      <header className="topbar">
        <h1>ตั้งค่า</h1>
        <button className="ghost" onClick={onClose}>
          ← กลับ
        </button>
      </header>
      <form className="card" onSubmit={save}>
        <div className="card-title">ข้อมูลของฉัน</div>
        <ProfileFields value={profile} onChange={setProfile} />
        {error && <div className="alert">{error}</div>}
        <div className="actions">
          <button type="submit">บันทึก</button>
        </div>
      </form>
      <Holidays />
    </div>
  )
}

/** Name (TH/EN) and default break; shared by Settings and the register form. */
export function ProfileFields({ value, onChange }: { value: Profile; onChange: (p: Profile) => void }) {
  const set = (change: Partial<Profile>) => onChange({ ...value, ...change })
  return (
    <>
      <div className="form-grid">
        <label>
          ชื่อ-นามสกุล (ไทย)
          <input value={value.nameTh} onChange={(e) => set({ nameTh: e.target.value })} required />
        </label>
        <label>
          ชื่อ EN (ใช้ตั้งชื่อไฟล์)
          <input
            value={value.nameEn}
            onChange={(e) => set({ nameEn: e.target.value.toUpperCase() })}
            pattern="[A-Za-z0-9 ]+"
            placeholder="JENWIT"
            required
          />
        </label>
        <label>
          พักต่อช่วง (นาที)
          <input
            type="number"
            min={0}
            max={60}
            step={5}
            value={value.defaultBreakMinutes}
            onChange={(e) => set({ defaultBreakMinutes: Number(e.target.value) })}
          />
        </label>
      </div>
      <p className="muted">
        ไฟล์ Export: <b>OT_YYMM_{value.nameEn.replace(/[^A-Za-z0-9]/g, '') || 'NAME'}.xlsx</b> · หักเวลาพักอัตโนมัติเมื่อช่วงเวลาครอบ
        12:00–13:00 หรือ 18:00–19:00
      </p>
    </>
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
