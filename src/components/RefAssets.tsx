import { useEffect, useState } from 'react'
import { ASSET_KINDS, type Asset, type AssetKind } from '../types'
import { IconCollapse, IconExpand, IconPlus, IconX } from './Icons'

interface Props {
  label: string
  assets: Asset[]
  thumbs: Record<string, string>
  onAdd: () => void
  onAddUrl: () => void
  onRemove: (label: string) => void
  onClear: () => void
}

/**
 * 参考素材区的三种形态：
 *   空     — 一张虚线「+ 参考内容」卡 + 用法说明
 *   收起   — 素材叠成一摞（最多露 3 张），hover 提示查看全部，点开展开
 *   展开   — 面板：按类型分页、清空、收起，末尾一个 + 继续加
 */
export function RefAssets({ label, assets, thumbs, onAdd, onAddUrl, onRemove, onClear }: Props) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'all' | AssetKind>('all')

  const total = assets.length

  // 清空后重置面板状态，否则下次加素材会直接蹦到展开态而不是叠放态
  useEffect(() => {
    if (total === 0) {
      setOpen(false)
      setTab('all')
    }
  }, [total])

  const countOf = (k: AssetKind) => assets.filter((a) => a.kind === k).length
  const shown = tab === 'all' ? assets : assets.filter((a) => a.kind === tab)

  const thumbOf = (a: Asset) =>
    a.path && thumbs[a.path] ? (
      <img src={thumbs[a.path]} alt="" />
    ) : (
      <span className="ref-item-ph">{a.kind === 'audio' ? '音频' : a.kind === 'video' ? '视频' : '图'}</span>
    )

  const addCard = (mini: boolean) => (
    <button
      className={mini ? 'slot slot-add mini' : 'slot slot-add'}
      onClick={onAdd}
      title="加参考素材：图片、视频、音频都行"
    >
      <IconPlus width={mini ? 15 : 16} height={mini ? 15 : 16} />
      {!mini && <span className="slot-label">{label}</span>}
    </button>
  )

  // 空态就一张卡，别的什么都不摆 —— 用法说明在展开面板里有
  if (total === 0) {
    return <div className="ref-box">{addCard(false)}</div>
  }

  if (!open) {
    const top = assets.slice(0, 3)
    const width = 58 + (top.length - 1) * 26 + (total > 3 ? 26 : 0)
    return (
      <div className="ref-box">
        <button
          className="ref-stack"
          style={{ width }}
          onClick={() => {
            setTab('all')
            setOpen(true)
          }}
        >
          {top.map((a, i) => (
            <span
              className="ref-item stacked"
              key={a.label}
              style={{ left: i * 26, zIndex: 5 - i, transform: `rotate(${i === 0 ? 0 : i % 2 ? -7 : 6}deg)` }}
            >
              {thumbOf(a)}
            </span>
          ))}
          {total > 3 && <span className="ref-stack-more">+{total - 3}</span>}
          <span className="ref-stack-peek">
            <IconExpand width={14} height={14} />
          </span>
          <span className="ref-stack-tip">查看全部</span>
        </button>
        {addCard(false)}
      </div>
    )
  }

  return (
    <div className="ref-panel">
      <div className="ref-panel-head">
        <button className={tab === 'all' ? 'ref-tab on' : 'ref-tab'} onClick={() => setTab('all')}>
          全部 ({total})
        </button>
        {ASSET_KINDS.map((k) => {
          const n = countOf(k.kind)
          return (
            <button
              key={k.kind}
              className={tab === k.kind ? 'ref-tab on' : 'ref-tab'}
              onClick={() => setTab(k.kind)}
            >
              {k.label}
              {n > 0 ? ` (${n})` : ''}
            </button>
          )
        })}
        <div className="spacer" />
        <button className="ref-clear" onClick={onAddUrl} title="视频音频太大传不动时，用公网地址">
          粘贴地址
        </button>
        <button className="ref-clear" onClick={onClear}>
          清空全部素材
        </button>
        <button className="icon-btn" onClick={() => setOpen(false)} title="收起">
          <IconCollapse width={13} height={13} />
        </button>
      </div>

      <div className="ref-panel-body">
        {shown.map((a) => (
          <span className="ref-item" key={a.label} title={a.path ?? a.url}>
            {thumbOf(a)}
            <span className="ref-item-tag">@{a.label}</span>
            <button className="ref-item-x" onClick={() => onRemove(a.label)} title="移除">
              <IconX width={10} height={10} />
            </button>
          </span>
        ))}
        {addCard(true)}
      </div>

      <div className="ref-panel-hint">
        使用 <b>@</b> 快速调用参考内容，例如：@Image1 模仿 @Video1 的动作，音色参考 @Audio1
      </div>
    </div>
  )
}
