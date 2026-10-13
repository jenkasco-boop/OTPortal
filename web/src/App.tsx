import { useCallback, useEffect, useState } from 'react'
import {
  api,
  periodOf,
  periodRange,
  setUnauthorizedHandler,
  thShortDate,
  toIsoDate,
  UnauthorizedError,
  type Employee,
  type Entry,
  type Report,
} from './api'
import EntryForm from './EntryForm'
import EntryTable from './EntryTable'
import Login from './Login'
import Settings from './Settings'
import TimelineImport from './TimelineImport'

const currentPeriod = () => periodOf(toIsoDate(new Date()))

export default function App() {
  // undefined = still checking the session, null = signed out
  const [employee, setEmployee] = useState<Employee | null | undefined>(undefined)
  const [month, setMonth] = useState(currentPeriod)
  const [entries, setEntries] = useState<Entry[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [editing, setEditing] = useState<Entry | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  const [error, setError] = useState('')

  const range = periodRange(month)
  const employeeId = employee?.id

  const signOut = useCallback(() => {
    setEmployee(null)
    setEntries([])
    setReport(null)
    setEditing(null)
    setShowSettings(false)
    setShowTimeline(false)
    setError('')
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(signOut)
    api
      .me()
      .then(setEmployee)
      .catch((e) => {
        if (!(e instanceof UnauthorizedError)) setError(e.message)
        setEmployee(null)
      })
  }, [signOut])

  const reload = useCallback(async () => {
    if (!employeeId) return
    const [list, rep] = await Promise.all([api.entries(month), api.report(month)])
    setEntries(list)
    setReport(rep)
  }, [employeeId, month])

  useEffect(() => {
    reload().catch((e) => e instanceof UnauthorizedError || setError(e.message))
  }, [reload])

  const logout = async () => {
    await api.logout().catch(() => {})
    signOut()
  }

  const remove = async (entry: Entry) => {
    if (!confirm(`ลบรายการวันที่ ${entry.date} ${entry.start.slice(0, 5)}-${entry.end.slice(0, 5)} ?`)) return
    await api.deleteEntry(entry.id)
    await reload()
  }

  if (employee === undefined) return <div className="page">{error || 'กำลังโหลด...'}</div>

  if (employee === null)
    return (
      <div className="page">
        <Login onSignedIn={setEmployee} />
      </div>
    )

  if (showSettings) {
    return (
      <div className="page">
        <Settings
          employee={employee}
          onSaved={(e) => {
            setEmployee(e)
            setShowSettings(false)
          }}
          onClose={() => setShowSettings(false)}
        />
      </div>
    )
  }

  return (
    <div className="page">
      <header className="topbar">
        <h1>OT Portal</h1>
        <div className="topbar-right">
          <label className="period">
            <span>
              รอบ {thShortDate(range.from)} – {thShortDate(range.to)}
            </span>
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </label>
          <button className="ghost" onClick={() => setShowTimeline((v) => !v)} title="สร้างรายการ OT จากไฟล์ Google Timeline">
            📍 Timeline
          </button>
          <button className="ghost" onClick={() => setShowSettings(true)} title="ตั้งค่า">
            {employee.nameTh} ({employee.nameEn}) ⚙
          </button>
          <button className="ghost" onClick={logout} title="ออกจากระบบ">
            ออกจากระบบ
          </button>
        </div>
      </header>

      {error && (
        <div className="alert" onClick={() => setError('')}>
          {error}
        </div>
      )}

      {showTimeline && (
        <TimelineImport
          employee={employee}
          month={month}
          entries={entries}
          onImported={() => reload().catch((e) => setError(e.message))}
          onClose={() => setShowTimeline(false)}
        />
      )}

      <EntryForm
        key={editing?.id ?? 'new'}
        employee={employee}
        month={month}
        editing={editing}
        recent={entries}
        onSaved={async (date) => {
          setEditing(null)
          if (periodOf(date) !== month) setMonth(periodOf(date))
          else await reload()
        }}
        onCancel={() => setEditing(null)}
      />

      <EntryTable
        entries={entries}
        report={report}
        exportUrl={api.exportUrl(month)}
        onEdit={setEditing}
        onDelete={(e) => remove(e).catch((err) => setError(err.message))}
        onError={setError}
      />
    </div>
  )
}
