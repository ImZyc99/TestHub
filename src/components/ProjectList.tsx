import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { IconCopy, IconPlus, IconTrash } from './Icons'
import { PROJECT_KINDS } from '../types'
import { RenameInput } from './RenameInput'

export function ProjectList() {
  const projects = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const createProject = useStore((s) => s.createProject)
  const switchProject = useStore((s) => s.switchProject)
  const renameProject = useStore((s) => s.renameProject)
  const duplicateProject = useStore((s) => s.duplicateProject)
  const deleteProject = useStore((s) => s.deleteProject)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const activeKind = useStore((s) => s.activeKind ?? 'text')
  // 只列当前模块下的项目 —— 类型由侧栏顶部的「测试内容」决定
  const visible = projects.filter((p) => (p.kind ?? 'text') === activeKind)
  const kindLabel = PROJECT_KINDS.find((k) => k.kind === activeKind)?.label ?? ''

  const beginRename = (id: string, name: string) => {
    setRenamingId(id)
    setDraft(name)
  }

  const commitRename = () => {
    if (renamingId) renameProject(renamingId, draft)
    setRenamingId(null)
  }

  // 切到别的项目时收起改名框。焦点如果早就跑到别处（比如顶栏的改名框），
  // blur 不会触发，这一行留着的输入框会一直卡在那儿。
  // 只在切走到「别的」项目时才收 —— 新建项目本身也会改 activeProjectId，
  // 无条件清空的话刚打开的改名框会被自己抹掉。
  useEffect(() => {
    setRenamingId((current) => (current && current !== activeProjectId ? null : current))
  }, [activeProjectId])

  // 类型已经由「测试内容」定了，加号直接建当前类型并进入改名
  const addProject = () => {
    const name = `${kindLabel}测试 ${visible.length + 1}`
    beginRename(createProject(name, activeKind), name)
  }

  return (
    <div className="sec sec-scroll">
      <div className="sec-head">
        <span className="sec-title">项目</span>
        <button className="icon-btn" onClick={addProject} title={`新建一个${kindLabel}项目`}>
          <IconPlus width={13} height={13} />
        </button>
      </div>

      <div className="sec-list">
        {visible.length === 0 && (
          <div className="empty-note">
            这个模块下还没有项目
            <br />
            点右上 + 新建一个
          </div>
        )}
        {visible.map((project) => {
        const active = project.id === activeProjectId
        const renaming = renamingId === project.id
        const bound = project.panels.slice(0, project.layout).filter((p) => p.modelId).length
        const running = project.panels.some((p) => p.status === 'streaming')

        return (
          <div
            key={project.id}
            className={active ? 'item project active' : 'item project'}
            onClick={() => !renaming && switchProject(project.id)}
            title={active ? '点击名称可改名' : '点击切换到这个项目'}
          >
            <span className={running ? 'dot running' : active ? 'dot on' : 'dot'} />

            {renaming ? (
              <RenameInput
                value={draft}
                onChange={setDraft}
                onCommit={commitRename}
                onCancel={() => setRenamingId(null)}
              />
            ) : (
              <span
                className="item-body"
                // 当前项目再点一次名称 = 改名；非当前项目点了是切换（交给外层）
                onClick={(e) => {
                  if (!active) return
                  e.stopPropagation()
                  beginRename(project.id, project.name)
                }}
              >
                <span className="item-label">{project.name}</span>
                <span className="item-sub">
                  {project.layout} 窗口 · {bound} 个模型
                </span>
              </span>
            )}

            {!renaming && (
              <span className="project-actions">
                <button
                  className="icon-btn"
                  title="复制这个项目（含对话）"
                  onClick={(e) => {
                    e.stopPropagation()
                    duplicateProject(project.id)
                  }}
                >
                  <IconCopy width={12} height={12} />
                </button>
                <button
                  className="icon-btn"
                  title="删除项目"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (window.confirm(`删除项目「${project.name}」？其中的对话会一并清除。`)) {
                      deleteProject(project.id)
                    }
                  }}
                >
                  <IconTrash width={12} height={12} />
                </button>
              </span>
            )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
