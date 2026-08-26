import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconClock } from './Icons'

interface Props {
  value?: number
  min: number
  max: number
  onChange: (v: number | undefined) => void
  /** 当前值超出模型允许范围 */
  bad?: boolean
  /** 单窗口布局下还能更长 —— 给出那个上限，面板里说明一句 */
  soloMax?: number
}

/** 滑杆下方的刻度：两端必标，中间取 5 的整数倍 */
function ticksFor(min: number, max: number): number[] {
  const out = new Set<number>([min, max])
  const step = max - min > 20 ? 10 : 5
  for (let v = Math.ceil(min / step) * step; v < max; v += step) out.add(v)
  return [...out].sort((a, b) => a - b)
}

export function DurationPicker({ value, min, max, onChange, bad, soloMax }: Props) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)

  // 没设过就当成最小值，滑杆总得有个位置
  const current = value ?? min
  const ticks = ticksFor(min, max)
  const pct = max > min ? ((current - min) / (max - min)) * 100 : 0

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const width = 320
    // 面板往上弹（参数条在底部），左边贴着按钮但别顶出窗口
    setPos({
      left: Math.min(Math.max(8, r.left), window.innerWidth - width - 8),
      bottom: window.innerHeight - r.top + 6,
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    const close = (e: Event) => {
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', () => setOpen(false))
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  const commit = (raw: number) => {
    if (!Number.isFinite(raw)) return
    onChange(Math.min(max, Math.max(min, Math.round(raw))))
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={bad ? 'chip bad' : open ? 'chip on' : 'chip'}
        onClick={() => setOpen((v) => !v)}
        title={`生成时长，这些模型支持 ${min}–${max} 秒`}
      >
        <IconClock width={13} height={13} />
        {value ?? min}
        <span className="chip-unit">s</span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div ref={panelRef} className="dur-panel" style={{ left: pos.left, bottom: pos.bottom }}>
            <div className="dur-title">选择视频生成时长</div>
            <div className="dur-row">
              <div className="dur-slider">
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={1}
                  value={current}
                  style={{ ['--fill' as string]: `${pct}%` }}
                  onChange={(e) => commit(Number(e.target.value))}
                />
                <div className="dur-ticks">
                  {ticks.map((t) => (
                    <button
                      key={t}
                      className={t === current ? 'dur-tick on' : 'dur-tick'}
                      style={{ left: `${((t - min) / (max - min)) * 100}%` }}
                      onClick={() => commit(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="dur-box">
                <input
                  className="dur-num"
                  type="number"
                  min={min}
                  max={max}
                  value={value ?? ''}
                  placeholder={String(min)}
                  onChange={(e) => (e.target.value === '' ? onChange(undefined) : commit(Number(e.target.value)))}
                />
                <span className="dur-unit">s</span>
              </div>
            </div>
            {soloMax && (
              <div className="dur-note">
                多窗口对比时统一上限 {max} 秒。切成<b>单窗口布局</b>最长可到 {soloMax} 秒。
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
