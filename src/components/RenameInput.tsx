import { useEffect, useRef } from 'react'

/**
 * 行内改名输入框。
 * 靠挂载时的 effect 聚焦 + 全选 —— autoFocus 配 onFocus 的触发时机不稳，
 * 会出现光标在但没选中、导致要先手动清空的情况。
 */
export function RenameInput({
  value,
  onChange,
  onCommit,
  onCancel,
  className = 'project-rename',
}: {
  value: string
  onChange: (v: string) => void
  onCommit: () => void
  onCancel: () => void
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  return (
    <input
      ref={ref}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur()
        if (e.key === 'Escape') onCancel()
      }}
    />
  )
}
