import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store'
import { Modal } from './Modal'
import type { DataInfo, DataMoveResult } from '../types'

export function SettingsModal() {
  const setModal = useStore((s) => s.setModal)
  const clearAll = useStore((s) => s.clearAll)
  const hydrate = useStore((s) => s.hydrate)
  const notify = useStore((s) => s.notify)

  const [info, setInfo] = useState<DataInfo | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => window.api.dataInfo().then(setInfo), [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const close = () => setModal(null)

  const applyMove = async (run: () => Promise<DataMoveResult>) => {
    setBusy(true)
    const res = await run()
    setBusy(false)

    if (res.canceled) return
    if (!res.ok) {
      notify(res.message ?? '换位置失败', 'err')
      return
    }

    await refresh()
    // 目标目录本来就有数据的话，现在生效的是那一份，得重新读进来
    await hydrate()
    notify(res.adopted ? '已切换到该目录里已有的数据' : '数据已迁移到新位置')
  }

  return (
    <Modal
      title="设置"
      onClose={close}
      footer={
        <>
          <button
            className="btn danger"
            onClick={() => {
              if (window.confirm('清空当前项目全部窗口的对话记录？模型配置和提示词库不受影响。')) {
                clearAll()
                close()
              }
            }}
          >
            清空当前项目的对话
          </button>
          <div className="spacer" />
          <button className="btn" onClick={close}>
            关闭
          </button>
        </>
      }
    >
      <div className="field">
        <label>数据存放位置</label>
        <div className="path-box" title={info?.dir}>
          {info?.dir ?? '读取中…'}
          {info && !info.isDefault && <span className="path-tag">自定义</span>}
        </div>
        <div className="row">
          <button className="btn sm" disabled={busy} onClick={() => applyMove(() => window.api.dataChoose())}>
            更改位置…
          </button>
          <button className="btn sm" onClick={() => void window.api.dataReveal()}>
            在访达中显示
          </button>
          {info && !info.isDefault && (
            <button className="btn sm" disabled={busy} onClick={() => applyMove(() => window.api.dataReset())}>
              恢复默认
            </button>
          )}
        </div>
      </div>

      <div className="field">
        <label>关于</label>
        <div className="hint">
          TestHub 0.1.0 — 多模型并行对话客户端。所有请求由本机直连你填写的 API 地址，不经过任何第三方服务。
        </div>
      </div>
    </Modal>
  )
}
