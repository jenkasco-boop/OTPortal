import { useEffect, useState } from 'react'

interface Props {
  value: string // HH:mm
  onChange: (value: string) => void
  required?: boolean
  invalid?: boolean
  title?: string
}

/** "930" → "09:30", "1830" → "18:30", "18" → "18:00", "9:05" → "09:05"; null when not a valid 24-hour time. */
export function parseTime(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})(?::?(\d{2}))?$/)
  if (!m) return null
  const hours = Number(m[1])
  const minutes = Number(m[2] ?? '00')
  if (hours > 23 || minutes > 59) return null
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

const STEP = 15

function shift(value: string, minutes: number) {
  const [h, m] = value.split(':').map(Number)
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Always 24-hour, unlike <input type="time"> which follows the OS locale (AM/PM). ↑/↓ moves 15 minutes. */
export default function TimeInput({ value, onChange, required, invalid, title }: Props) {
  const [text, setText] = useState(value)

  // Follow outside changes (preset chips, edits elsewhere).
  useEffect(() => setText(value), [value])

  const update = (next: string) => {
    setText(next)
    const parsed = next.length >= 4 ? parseTime(next) : null
    if (parsed && parsed !== value) onChange(parsed)
  }

  const commit = () => {
    const parsed = parseTime(text)
    if (parsed) {
      setText(parsed)
      if (parsed !== value) onChange(parsed)
    } else setText(value)
  }

  return (
    <input
      className={`time-input ${invalid ? 'invalid' : ''}`}
      aria-invalid={invalid || undefined}
      title={title}
      value={text}
      inputMode="numeric"
      placeholder="HH:mm"
      maxLength={5}
      required={required}
      onChange={(e) => update(e.target.value.replace(/[^\d:]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
        e.preventDefault()
        onChange(shift(parseTime(text) ?? value, e.key === 'ArrowUp' ? STEP : -STEP))
      }}
    />
  )
}
