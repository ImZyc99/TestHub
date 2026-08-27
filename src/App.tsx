import { useEffect, useState } from 'react'
import { useActiveProject, useFocusedPanelId, useLayout, usePanels, useStore } from './store'
import { LAYOUT_GRID } from './types'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { Composer } from './components/Composer'
import { SystemPromptModal } from './components/SystemPromptModal'
import { ModelModal } from './components/ModelModal'
import { PromptLibraryModal } from './components/PromptLibraryModal'
import { SettingsModal } from './components/SettingsModal'
import { IconBroadcast, IconCollapse, IconSparkle, IconTrash } from './components/Icons'
import { RenameInput } from './components/RenameInput'
import { money } from './lib/money'

function Grid() {
  const layout = useLayout()
  const panels = usePanels()
  const focusedPanelId = useFocusedPanelId()

  const visible = panels.slice(0, layout)
  const focusedIndex = visible.findIndex((p) => p.id === focusedPanelId)

  // 聚焦模式：主窗口占左边，其余按原顺序收进右侧可滚动的列
  if (focusedIndex >= 0) {
    return (
      <div className="grid focus-layout">
        <div className="focus-main">
          <ChatPanel
            key={visible[focusedIndex].id}
            panel={visible[focusedIndex]}
            index={focusedIndex}
            focused
          />
        </div>
        <div className="focus-side">
          {visible.map((panel, i) =>
            i === focusedIndex ? null : <ChatPanel key={panel.id} panel={panel} index={i} mini />,
          )}
        </div>
      </div>
    )
  }

  const { cols, rows } = LAYOUT_GRID[layout]
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {visible.map((panel, i) => (
        <ChatPanel key={panel.id} panel={panel} index={i} />
      ))}
    </div>
  )
}

function Topbar() {
  const project = useActiveProject()
  const layout = useLayout()
  const panels = usePanels()
  const focusedPanelId = useFocusedPanelId()
  const clearFocus = useStore((s) => s.clearFocus)
  const clearAll = useStore((s) => s.clearAll)
  const renameProject = useStore((s) => s.renameProject)
  const syncSystemPromptToAll = useStore((s) => s.syncSystemPromptToAll)
  const clearAllSystemPrompts = useStore((s) => s.clearAllSystemPrompts)
  const setModal = useStore((s) => s.setModal)
  const notify = useStore((s) => s.notify)

  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')

  // 切到别的项目时把改名框收起来，否则旧草稿会 blur 到新项目头上
  useEffect(() => {
    setRenaming(false)
  }, [project.id])

  const visible = panels.slice(0, layout)
  const hasMessages = visible.some((p) => p.messages.length > 0)
  const distinctPrompts = new Set(visible.map((p) => p.systemPrompt))
  const promptsInSync = distinctPrompts.size === 1
  const currentPrompt = visible[0]?.systemPrompt ?? ''

  // 生成类项目按 system prompt 分组没意义，用户真正关心的是这轮对比花了多少钱
  const isGen = (project.kind ?? 'text') !== 'text'
  const spend = project.panels.reduce(
    (acc, p) => {
      for (const m of p.messages) {
        const amount = m.cost?.amount
        if (typeof amount === 'number') {
          acc.total += amount
          acc.count += 1
        }
      }
      return acc
    },
    { total: 0, count: 0 },
  )

  return (
    <div className="topbar">
      {renaming ? (
        <RenameInput
          className="topbar-rename"
          value={draft}
          onChange={setDraft}
          onCommit={() => {
            renameProject(project.id, draft)
            setRenaming(false)
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <button
          className="topbar-project"
          onClick={() => {
            setDraft(project.name)
            setRenaming(true)
          }}
          title="点击重命名项目"
        >
          {project.name}
        </button>
      )}
      <span className="topbar-sep">·</span>
      {isGen ? (
        spend.count > 0 ? (
          <span className="topbar-title" title="本项目全部窗口累计，按接口返回的金额相加">
            本项目累计 <strong className="spend">¥{money(spend.total)}</strong>
            <span className="topbar-dim"> · {spend.count} 次生成</span>
          </span>
        ) : (
          <span className="topbar-title">还没有生成记录</span>
        )
      ) : (
        <span className="topbar-title">
          {promptsInSync
            ? currentPrompt
              ? '全部窗口使用同一条 system prompt'
              : '全部窗口未设置 system prompt'
            : `${distinctPrompts.size} 种不同的 system prompt`}
        </span>
      )}
      <div className="spacer" />
      {focusedPanelId && (
        <button className="btn sm" onClick={clearFocus} title="回到网格布局">
          <IconCollapse width={12} height={12} />
          退出聚焦 <span className="kbd">Esc</span>
        </button>
      )}
      {!isGen && (
      <button
        className="btn sm"
        onClick={() => {
          const first = visible.find((p) => p.systemPrompt.trim())
          if (!first) {
            notify('当前没有任何窗口设置了 system prompt', 'err')
            setModal({ type: 'systemPrompt', panelId: visible[0]?.id ?? 'panel-1' })
            return
          }
          syncSystemPromptToAll(first.systemPrompt)
        }}
        title="把第一个非空的 system prompt 同步给所有窗口"
      >
        <IconBroadcast width={12} height={12} />
        同步 SP
      </button>
      )}
      {!isGen && (
        <button
          className="btn sm"
          disabled={!project.panels.some((p) => p.systemPrompt.trim())}
          onClick={() => {
            const n = project.panels.filter((p) => p.systemPrompt.trim()).length
            // SP 可能是长文，误点丢了没处找回 —— 先确认
            if (window.confirm(`清除全部 ${n} 个窗口的 system prompt？清掉后无法找回。`)) {
              clearAllSystemPrompts()
              notify('已清除所有窗口的 system prompt')
            }
          }}
          title="把所有窗口的 system prompt 一键清空（不影响模型级默认值）"
        >
          <IconSparkle width={12} height={12} />
          清除 SP
        </button>
      )}
      <button className="btn sm" onClick={clearAll} disabled={!hasMessages}>
        <IconTrash width={12} height={12} />
        清空全部
      </button>
    </div>
  )
}

function Modals() {
  const modal = useStore((s) => s.modal)
  if (!modal) return null
  switch (modal.type) {
    case 'systemPrompt':
      return <SystemPromptModal panelId={modal.panelId} />
    case 'model':
      return <ModelModal modelId={modal.modelId} />
    case 'library':
      return <PromptLibraryModal />
    case 'settings':
      return <SettingsModal />
  }
}

function Toast() {
  const toast = useStore((s) => s.toast)
  if (!toast) return null
  return <div className={toast.tone === 'err' ? 'toast err' : 'toast'}>{toast.text}</div>
}

export default function App() {
  const ready = useStore((s) => s.ready)
  const theme = useStore((s) => s.theme)
  const hydrate = useStore((s) => s.hydrate)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // Esc 退出聚焦 —— 弹窗自己会先吃掉 Esc，这里只处理没有弹窗时的情况
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 正在输入框里打字时，Esc 是给输入框的（取消改名等），别在这儿抢
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const state = useStore.getState()
      const focused = state.projects.find((p) => p.id === state.activeProjectId)?.focusedPanelId
      if (state.modal || !focused) return
      state.clearFocus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  if (!ready) return null

  return (
    <div className={window.api.platform === 'darwin' ? 'app mac' : 'app'}>
      <Sidebar />
      <div className="main">
        <Topbar />
        <Grid />
        <Composer />
      </div>
      <Modals />
      <Toast />
    </div>
  )
}
