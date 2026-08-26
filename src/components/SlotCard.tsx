import { IconPlus, IconX } from './Icons'

interface Props {
  label: string
  /** 缩略图 data URL；没有就显示占位 */
  thumb?: string
  /** 已填内容的简短描述（文件名或地址） */
  filled?: string
  /** 素材类型，决定占位里显示什么字 */
  kindLabel?: string
  onPick: () => void
  onClear?: () => void
}

/**
 * 输入区的素材卡片。空的时候是一张虚线占位卡，
 * 填了就换成缩略图 —— 和参考图里那套「+ 参考内容 / + 首帧」一致。
 */
export function SlotCard({ label, thumb, filled, kindLabel, onPick, onClear }: Props) {
  if (!filled) {
    return (
      <button className="slot" onClick={onPick} title={`添加${label}`}>
        <IconPlus width={16} height={16} />
        <span className="slot-label">{label}</span>
      </button>
    )
  }
  return (
    <div className="slot filled" title={filled}>
      {thumb ? <img src={thumb} alt="" /> : <span className="slot-ph">{kindLabel ?? '素材'}</span>}
      <span className="slot-tag">{label}</span>
      {onClear && (
        <button className="slot-x" onClick={onClear} title={`移除${label}`}>
          <IconX width={10} height={10} />
        </button>
      )}
    </div>
  )
}
