import { useState } from 'react'
import { useStore, uid } from '../store'
import { Modal } from './Modal'
import { IconBroadcast, IconEdit, IconPlus, IconTrash } from './Icons'
import type { PromptPreset } from '../types'

export function PromptLibraryModal() {
  const presets = useStore((s) => s.presets)
  const upsertPreset = useStore((s) => s.upsertPreset)
  const removePreset = useStore((s) => s.removePreset)
  const applyPresetToAll = useStore((s) => s.applyPresetToAll)
  const setModal = useStore((s) => s.setModal)

  const [editing, setEditing] = useState<PromptPreset | null>(null)

  const close = () => setModal(null)

  const startNew = () =>
    setEditing({ id: uid(), name: '', content: '', updatedAt: Date.now() })

  if (editing) {
    const valid = editing.name.trim() && editing.content.trim()
    return (
      <Modal
        title={presets.some((p) => p.id === editing.id) ? '编辑提示词' : '新建提示词'}
        onClose={() => setEditing(null)}
        wide
        footer={
          <>
            <div className="spacer" />
            <button className="btn" onClick={() => setEditing(null)}>
              取消
            </button>
            <button
              className="btn primary"
              disabled={!valid}
              onClick={() => {
                upsertPreset({ ...editing, name: editing.name.trim(), updatedAt: Date.now() })
                setEditing(null)
              }}
            >
              保存
            </button>
          </>
        }
      >
        <div className="field">
          <label>名称</label>
          <input
            className="input"
            autoFocus
            value={editing.name}
            placeholder="例如：严格中文回答"
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          />
        </div>
        <div className="field">
          <label>内容</label>
          <textarea
            className="textarea"
            rows={10}
            value={editing.content}
            onChange={(e) => setEditing({ ...editing, content: e.target.value })}
          />
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      title="提示词库"
      onClose={close}
      wide
      tall
      footer={
        <>
          <button className="btn" onClick={startNew}>
            <IconPlus width={13} height={13} />
            新建
          </button>
          <div className="spacer" />
          <button className="btn" onClick={close}>
            关闭
          </button>
        </>
      }
    >
      {presets.length === 0 ? (
        <div className="empty-note">还没有存过提示词。点左下「新建」，或在任意窗口的 SP 面板里存入。</div>
      ) : (
        <div className="preset-list">
          {presets.map((p) => (
            <div className="preset-row" key={p.id}>
              <div className="item-body">
                <div className="preset-name">{p.name}</div>
                <div className="preset-preview">{p.content}</div>
              </div>
              <button
                className="btn sm"
                onClick={() => {
                  applyPresetToAll(p.id)
                  close()
                }}
                title="写入全部 9 个窗口"
              >
                <IconBroadcast width={12} height={12} />
                应用到全部
              </button>
              <button className="icon-btn" onClick={() => setEditing(p)} title="编辑">
                <IconEdit width={13} height={13} />
              </button>
              <button
                className="icon-btn"
                onClick={() => window.confirm(`删除「${p.name}」？`) && removePreset(p.id)}
                title="删除"
              >
                <IconTrash width={13} height={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
