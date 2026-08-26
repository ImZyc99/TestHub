import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconChevronDown, IconCheck } from './Icons'

export interface DropdownOption {
  value: string
  label: string
  /** 选项左侧的图标 */
  icon?: ReactNode
  /** 右侧的 Beta 之类角标 */
  badge?: string
  /** 第二行小字，比如模型 ID */
  sub?: string
  disabled?: boolean
  /** 分组标题：给出后这一项前面会插一条分隔标题 */
  group?: string
}

interface Props {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  title?: string
  disabled?: boolean
  /** 触发器里自定义渲染（不给就显示选中项的 label） */
  renderTrigger?: (selected: DropdownOption | undefined) => ReactNode
  /** 触发器本身就是个卡片之类的形状时，右侧的小箭头是多余的 */
  hideCaret?: boolean
}

/**
 * 自定义下拉。原生 <select> 的弹层由系统绘制，跟不上主题也放不下第二行小字，
 * 所以整套换成自绘：菜单用 portal 挂到 body，避免被窗口的 overflow 裁掉。
 */
export function Dropdown({
  value,
  options,
  onChange,
  placeholder = '请选择',
  className = '',
  title,
  disabled,
  renderTrigger,
  hideCaret,
}: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; drop: 'down' | 'up' } | null>(null)

  const selected = options.find((o) => o.value === value)

  // options / onChange 多半是调用方内联构造的，每次渲染都是新引用。
  // 直接写进副作用依赖会造成「定位 → setState → 重渲染 → 依赖又变」的死循环，
  // 所以统一用 ref 兜住，副作用只认 open。
  const latest = useRef({ options, value, onChange })
  latest.current = { options, value, onChange }

  // 打开时贴着触发器定位；下方放不下就往上翻
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const { options: opts, value: val } = latest.current
    const r = btnRef.current.getBoundingClientRect()
    const wanted = Math.min(opts.length * 40 + 12, 320)
    const below = window.innerHeight - r.bottom - 8
    const drop = below < wanted && r.top > below ? 'up' : 'down'
    setPos({
      left: r.left,
      top: drop === 'down' ? r.bottom + 4 : r.top - 4,
      width: r.width,
      drop,
    })
    setActive(Math.max(0, opts.findIndex((o) => o.value === val)))
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      const options = latest.current.options
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        btnRef.current?.focus()
        return
      }
      const usable = options.filter((o) => !o.disabled)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setActive((cur) => {
          let next = cur
          for (let i = 0; i < options.length; i++) {
            next = (next + step + options.length) % options.length
            if (!options[next]?.disabled) break
          }
          return next
        })
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setActive((cur) => {
          const opt = options[cur]
          if (opt && !opt.disabled) {
            latest.current.onChange(opt.value)
            setOpen(false)
            btnRef.current?.focus()
          }
          return cur
        })
      } else if (e.key === 'Home' && usable.length) {
        e.preventDefault()
        setActive(options.indexOf(usable[0]))
      } else if (e.key === 'End' && usable.length) {
        e.preventDefault()
        setActive(options.indexOf(usable[usable.length - 1]))
      }
    }
    const onResize = () => setOpen(false)
    // 捕获阶段监听任意祖先滚动 —— 菜单是 fixed 定位的，页面一滚就会飘在原地。
    // 但要放过菜单自己的滚动：高亮项 scrollIntoView 也会冒出 scroll 事件，
    // 不排除的话菜单刚打开就被自己关掉了。
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  // 键盘移动时把高亮项滚进视野
  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('.dd-opt.active')?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`dd-trigger ${className}`}
        title={title}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span className="dd-value">
          {renderTrigger ? renderTrigger(selected) : (selected?.label ?? <span className="dd-ph">{placeholder}</span>)}
        </span>
        {!hideCaret && <IconChevronDown width={12} height={12} className="dd-caret" />}
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="dd-menu"
            role="listbox"
            style={{
              left: pos.left,
              width: Math.max(pos.width, 180),
              ...(pos.drop === 'down'
                ? { top: pos.top }
                : { bottom: window.innerHeight - pos.top }),
            }}
          >
            {options.map((o, i) => (
              <div key={o.value || `__${i}`}>
                {o.group && <div className="dd-group">{o.group}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className={[
                    'dd-opt',
                    i === active ? 'active' : '',
                    o.value === value ? 'on' : '',
                    o.disabled ? 'disabled' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  disabled={o.disabled}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => {
                    onChange(o.value)
                    setOpen(false)
                    btnRef.current?.focus()
                  }}
                >
                  {o.icon}
                  <span className="dd-opt-body">
                    <span className="dd-opt-label">
                      {o.label}
                      {o.badge && <span className="dd-beta">{o.badge}</span>}
                    </span>
                    {o.sub && <span className="dd-opt-sub">{o.sub}</span>}
                  </span>
                  {o.value === value && <IconCheck width={12} height={12} />}
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
