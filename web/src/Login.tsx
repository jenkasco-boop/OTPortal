import { useState } from 'react'
import { api, type Employee, type Profile } from './api'
import { ProfileFields } from './Settings'

interface Props {
  onSignedIn: (e: Employee) => void
}

export default function Login({ onSignedIn }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [profile, setProfile] = useState<Profile>({ nameTh: '', nameEn: '', defaultBreakMinutes: 60 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const switchMode = (next: 'login' | 'register') => {
    setMode(next)
    setError('')
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'register' && password !== confirm) return setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน')
    setBusy(true)
    try {
      onSignedIn(mode === 'login' ? await api.login(username, password) : await api.register(username, password, profile))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <header className="topbar">
        <h1>OT Portal</h1>
      </header>
      <form className="card" onSubmit={submit}>
        <div className="chips tabs">
          <button type="button" className={`chip ${mode === 'login' ? 'active' : ''}`} onClick={() => switchMode('login')}>
            เข้าสู่ระบบ
          </button>
          <button type="button" className={`chip ${mode === 'register' ? 'active' : ''}`} onClick={() => switchMode('register')}>
            สมัครใช้งาน
          </button>
        </div>

        <div className="form-grid">
          <label>
            ชื่อผู้ใช้
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              autoComplete="username"
              autoCapitalize="none"
              pattern="[a-z0-9._\-]{3,32}"
              title="3-32 ตัว ใช้ได้เฉพาะ a-z, 0-9 และ . _ -"
              required
              autoFocus
            />
          </label>
          <label>
            รหัสผ่าน
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'register' ? 8 : undefined}
              required
            />
          </label>
          {mode === 'register' && (
            <label>
              ยืนยันรหัสผ่าน
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </label>
          )}
        </div>

        {mode === 'register' && (
          <>
            <div className="card-title section">ข้อมูลพนักงาน</div>
            <ProfileFields value={profile} onChange={setProfile} />
            <p className="muted">ถ้าเคยใช้งานก่อนมีระบบ login ให้ใส่ชื่อ EN เดิม ข้อมูล OT เดิมจะผูกกับบัญชีนี้</p>
          </>
        )}

        {error && <div className="alert">{error}</div>}
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? 'กำลังดำเนินการ...' : mode === 'login' ? 'เข้าสู่ระบบ' : 'สมัครและเข้าสู่ระบบ'}
          </button>
        </div>
      </form>
    </div>
  )
}
