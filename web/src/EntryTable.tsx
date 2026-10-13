import { duration, hhmm, shortTime, thDay, type Entry, type Report } from './api'

interface Props {
  entries: Entry[]
  report: Report | null
  exportUrl: string
  onEdit: (e: Entry) => void
  onDelete: (e: Entry) => void
}

const fmtDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

export default function EntryTable({ entries, report, exportUrl, onEdit, onDelete }: Props) {
  const t = report?.totals

  return (
    <section className="card">
      <div className="card-title">
        รายการเดือนนี้ <span className="muted">{entries.length} รายการ</span>
        <a className={`button export ${entries.length ? '' : 'disabled'}`} href={entries.length ? exportUrl : undefined} download>
          ⬇ {report?.fileName ?? 'Export'}.xlsx
        </a>
      </div>

      {entries.length === 0 ? (
        <p className="muted empty">ยังไม่มีรายการในเดือนนี้</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>วันที่</th>
                <th>เวลา</th>
                <th className="num">พัก</th>
                <th>OT</th>
                <th>หมายเหตุ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>
                    {thDay(e.date)} {fmtDate(e.date)}
                  </td>
                  <td>
                    {shortTime(e.start)}–{shortTime(e.end)}
                    {e.support && <span className="badge weekend">Support</span>}
                  </td>
                  <td className="num">{e.breakMinutes || ''}</td>
                  <td>
                    {e.result.segments
                      .filter((s) => s.isPaid)
                      .map((s, i) => (
                        <span key={i} className={`seg small rate-${String(s.rate).replace('.', '')}`} title={`${hhmm(s.startMinute)}–${hhmm(s.endMinute)}`}>
                          {s.rate.toFixed(1)} × {duration(s.netMinutes)}
                        </span>
                      ))}
                  </td>
                  <td className="remark-cell">{e.remark}</td>
                  <td className="row-actions">
                    <button className="ghost small" onClick={() => onEdit(e)}>
                      แก้ไข
                    </button>
                    <button className="ghost small danger" onClick={() => onDelete(e)}>
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {t && entries.length > 0 && (
        <div className="totals">
          <div>
            <span>OT 1.0</span>
            <b>{duration(t.ot10)}</b>
          </div>
          <div>
            <span>OT 1.5</span>
            <b>{duration(t.ot15)}</b>
          </div>
          <div>
            <span>OT 3.0</span>
            <b>{duration(t.ot30)}</b>
          </div>
          <div className="highlight">
            <span>OT × Time (ชม.)</span>
            <b>{(t.otxTime / 60).toFixed(2)}</b>
          </div>
        </div>
      )}
    </section>
  )
}
