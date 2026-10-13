import { useCallback, useEffect, useState } from 'react'
import { api, periodOf, periodRange, thShortDate, toIsoDate, type Employee, type Entry, type Report } from './api'
import EntryForm from './EntryForm'
import EntryTable from './EntryTable'
import Settings from './Settings'
import TimelineImport from './TimelineImport'

const EMPLOYEE_KEY = 'otportal.employeeId'

const currentPeriod = () => periodOf(toIsoDate(new Date()))

function readStoredEmployee(): number | null {
  try {
    const v = localStorage.getItem(EMPLOYEE_KEY)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

export default function App() {
  const [employees, setEmployees] = useState<Employee[] | null>(null)
  const [employeeId, setEmployeeId] = useState<number | null>(readStoredEmployee)
  const [month, setMonth] = useState(currentPeriod)
  const [entries, setEntries] = useState<Entry[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [editing, setEditing] = useState<Entry | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  const [error, setError] = useState('')

  const employee = employees?.find((e) => e.id === employeeId) ?? null
  const range = periodRange(month)

  const loadEmployees = useCallback(async () => {
    const list = await api.employees()
    setEmployees(list)
    return list
  }, [])

  useEffect(() => {
    loadEmployees().catch((e) => setError(e.message))
  }, [loadEmployees])

  const selectEmployee = (id: number) => {
    setEmployeeId(id)
    try {
      localStorage.setItem(EMPLOYEE_KEY, String(id))
    } catch {
      /* storage unavailable */
    }
  }

  const reload = useCallback(async () => {
    if (!employee) return
    const [list, rep] = await Promise.all([api.entries(employee.id, month), api.report(employee.id, month)])
    setEntries(list)
    setReport(rep)
  }, [employee, month])

  useEffect(() => {
    reload().catch((e) => setError(e.message))
  }, [reload])

  const remove = async (entry: Entry) => {
    if (!confirm(`ลบรายการวันที่ ${entry.date} ${entry.start.slice(0, 5)}-${entry.end.slice(0, 5)} ?`)) return
    await api.deleteEntry(entry.id)
    await reload()
  }

  if (employees === null) return <div className="page">{error || 'กำลังโหลด...'}</div>

  // First run (or the stored employee was deleted): set up the profile once.
  if (!employee || showSettings) {
    return (
      <div className="page">
        <Settings
          employee={employee}
          employees={employees}
          onSelect={(id) => {
            selectEmployee(id)
            setShowSettings(false)
          }}
          onSaved={async (e) => {
            await loadEmployees()
            selectEmployee(e.id)
            setShowSettings(false)
          }}
          onClose={employee ? () => setShowSettings(false) : undefined}
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
        exportUrl={api.exportUrl(employee.id, month)}
        onEdit={setEditing}
        onDelete={(e) => remove(e).catch((err) => setError(err.message))}
      />
    </div>
  )
}
