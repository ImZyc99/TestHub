import { useLayout, useStore } from '../store'
import { LAYOUTS, PROJECT_KINDS, type ProjectKind } from '../types'
import { ProjectList } from './ProjectList'
import {
  IconBook,
  IconImage,
  IconMoon,
  IconPlus,
  IconSettings,
  IconSliders,
  IconSun,
  IconType,
  IconVideo,
  LayoutIcon,
} from './Icons'
import logoUrl from '../assets/logo.png'

const KIND_ICON: Record<ProjectKind, (p: { width: number; height: number }) => JSX.Element> = {
  text: (p) => <IconType {...p} />,
  image: (p) => <IconImage {...p} />,
  video: (p) => <IconVideo {...p} />,
}

export function Sidebar() {
  const layout = useLayout()
  const setLayout = useStore((s) => s.setLayout)
  const models = useStore((s) => s.models)
  const presets = useStore((s) => s.presets)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const setModal = useStore((s) => s.setModal)
  const activeKind = useStore((s) => s.activeKind ?? 'text')
  const setActiveKind = useStore((s) => s.setActiveKind)

  // 每个模块下有几个能用的模型 —— 一眼看出哪个模块还没配
  const countByKind = (kind: ProjectKind) => models.filter((m) => (m.kind ?? 'text') === kind).length

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <img className="brand-mark" src={logoUrl} alt="" draggable={false} />
          TestHub
        </div>
      </div>

      {/* 高度固定的几块，永远待在上面 */}
      <div className="sidebar-fixed">
        <div className="sec">
          <div className="sec-head">
            <span className="sec-title">窗口布局</span>
          </div>
          <div className="layout-grid">
            {LAYOUTS.map((n) => (
              <button
                key={n}
                className={n === layout ? 'layout-btn active' : 'layout-btn'}
                onClick={() => setLayout(n)}
                title={`${n} 个窗口`}
              >
                <LayoutIcon count={n} />
              </button>
            ))}
          </div>
        </div>

        <div className="sec">
          <div className="sec-head">
            <span className="sec-title">测试内容</span>
          </div>
          <div className="kind-tabs">
            {PROJECT_KINDS.map(({ kind, label, hint }) => {
              const Icon = KIND_ICON[kind]
              const n = countByKind(kind)
              return (
                <button
                  key={kind}
                  className={kind === activeKind ? 'kind-tab active' : 'kind-tab'}
                  onClick={() => setActiveKind(kind)}
                  title={`${hint}${n === 0 ? ' · 还没有配这一类的模型' : ` · ${n} 个模型`}`}
                >
                  <Icon width={15} height={15} />
                  <span className="kind-tab-label">{label}</span>
                  <span className={n === 0 ? 'kind-tab-n zero' : 'kind-tab-n'}>{n}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="sec">
          <div className="sec-head">
            <span className="sec-title">提示词库</span>
            <button className="icon-btn" onClick={() => setModal({ type: 'library' })} title="管理提示词库">
              <IconPlus width={13} height={13} />
            </button>
          </div>
          <button className="item" onClick={() => setModal({ type: 'library' })}>
            <IconBook width={14} height={14} />
            <span className="item-label">管理 System Prompt</span>
            <span className="item-sub">{presets.length}</span>
          </button>
        </div>
      </div>

      {/* 项目列表占满剩下的空间，条目多了在自己区域里滚 */}
      <div className="sidebar-lists">
        <ProjectList />
      </div>

      <div className="sidebar-foot">
        <button
          className="icon-btn"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
        >
          {theme === 'dark' ? <IconSun width={14} height={14} /> : <IconMoon width={14} height={14} />}
        </button>
        <button className="icon-btn" onClick={() => setModal({ type: 'settings' })} title="设置与数据位置">
          <IconSettings width={14} height={14} />
        </button>
        <div className="spacer" />
        <button className="btn sm" onClick={() => setModal({ type: 'model', modelId: null })}>
          <IconSliders width={12} height={12} />
          配置模型
        </button>
      </div>
    </aside>
  )
}
