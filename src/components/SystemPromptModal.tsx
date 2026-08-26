import { useMemo, useState } from 'react'
import { usePanels, useStore, uid } from '../store'
import { Modal } from './Modal'
import { IconBroadcast, IconBook, IconPlus } from './Icons'

export function SystemPromptModal({ panelId }: { panelId: string }) {
  const panel = usePanels().find((p) => p.id === panelId)
  const models = useStore((s) => s.models)
  const presets = useStore((s) => s.presets)
  const setModal = useStore((s) => s.setModal)
  const setPanelSystemPrompt = useStore((s) => s.setPanelSystemPrompt)
  const syncSystemPromptToAll = useStore((s) => s.syncSystemPromptToAll)
  const saveSystemPromptToModel = useStore((s) => s.saveSystemPromptToModel)
  const upsertPreset = useStore((s) => s.upsertPreset)
  const notify = useStore((s) => s.notify)

  const [draft, setDraft] = useState(panel?.systemPrompt ?? '')

  const model = useMemo(() => models.find((m) => m.id === panel?.modelId), [models, panel?.modelId])
  const close = () => setModal(null)

  if (!panel) return null

  const commit = (text: string) => {
    setDraft(text)
    setPanelSystemPrompt(panelId, text)
  }

  const panelIndex = Number(panel.id.split('-')[1] ?? 0)
  const modelDefaultDiffers = !!model && model.systemPrompt !== draft

  const saveAsPreset = () => {
    if (!draft.trim()) return
    const name = window.prompt('给这条提示词起个名字', model ? `${model.name} 的设定` : '新提示词')
    if (!name) return
    upsertPreset({ id: uid(), name, content: draft, updatedAt: Date.now() })
    notify(`已存入提示词库：${name}`)
  }

  return (
    <Modal
      title={`窗口 ${panelIndex} 的 System Prompt${model ? ` · ${model.name}` : ''}`}
      onClose={close}
      wide
      footer={
        <>
          <button
            className="btn"
            onClick={() => {
              syncSystemPromptToAll(draft)
              close()
            }}
            title="把这段提示词写入全部 9 个窗口"
          >
            <IconBroadcast width={13} height={13} />
            同步到所有窗口
          </button>
          <button
            className="btn"
            disabled={!model || !modelDefaultDiffers}
            onClick={() => saveSystemPromptToModel(panelId)}
            title={model ? `以后选中「${model.name}」时自动带出这段提示词` : '该窗口未绑定模型'}
          >
            存为该模型默认
          </button>
          <div className="spacer" />
          <button className="btn" onClick={close}>
            完成
          </button>
        </>
      }
    >
      <div className="field">
        <label>提示词内容</label>
        <textarea
          className="textarea"
          rows={10}
          autoFocus
          value={draft}
          placeholder="例如：你是一名资深后端工程师，回答务必简洁，先给结论再给理由。"
          onChange={(e) => commit(e.target.value)}
        />
        <div className="row">
          <span className="hint">
            {draft.length} 字 · 每轮请求都会作为 system 消息发送
            {model && !modelDefaultDiffers && draft ? ' · 已是该模型的默认值' : ''}
          </span>
          <div className="spacer" />
          <button className="btn sm ghost" onClick={saveAsPreset} disabled={!draft.trim()}>
            <IconPlus width={12} height={12} />
            存入提示词库
          </button>
          <button className="btn sm ghost" onClick={() => commit('')} disabled={!draft}>
            清空
          </button>
        </div>
      </div>

      <div className="field">
        <label>
          <IconBook width={12} height={12} style={{ verticalAlign: -2, marginRight: 5 }} />
          从提示词库套用
        </label>
        {presets.length === 0 ? (
          <div className="empty-note">提示词库还是空的，可以先把上面这段存进去。</div>
        ) : (
          <div className="chips">
            {presets.map((p) => (
              <button key={p.id} className="chip" title={p.content} onClick={() => commit(p.content)}>
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
