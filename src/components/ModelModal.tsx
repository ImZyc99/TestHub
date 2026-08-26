import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, uid } from '../store'
import { Modal } from './Modal'
import { Dropdown } from './Dropdown'
import { PROVIDER_PRESETS, GEN_PRESETS, emptyGenConfig } from '../lib/presets'
import { PARAM_PROFILES } from '../lib/paramProfiles'
import {
  MODEL_CAPS,
  PROJECT_KINDS,
  REASONING_EFFORTS,
  type CapOptions,
  type GenConfig,
  type ModelCap,
  type ModelConfig,
  type ProjectKind,
} from '../types'
import { IconPlus, IconTrash } from './Icons'

const blank = (kind: ProjectKind = 'text'): ModelConfig => ({
  id: uid(),
  name: '',
  baseURL: '',
  model: '',
  temperature: null,
  maxTokens: null,
  systemPrompt: '',
  kind,
  caps: kind === 'text' ? [] : ['ratio', ...(kind === 'video' ? (['duration'] as ModelCap[]) : (['size'] as ModelCap[]))],
  reasoningEffort: null,
  gen: kind === 'text' ? undefined : emptyGenConfig(),
})

/** 拿来判断「有没有改过」—— 只比对会被保存的字段 */
const fingerprint = (m: ModelConfig) =>
  JSON.stringify({ ...m, hasKey: undefined })

export function ModelModal({ modelId }: { modelId: string | null }) {
  const models = useStore((s) => s.models)
  const upsertModel = useStore((s) => s.upsertModel)
  const removeModel = useStore((s) => s.removeModel)
  const setModal = useStore((s) => s.setModal)
  const notify = useStore((s) => s.notify)
  const activeKind = useStore((s) => s.activeKind ?? 'text')

  // 当前正在编辑谁：null = 新建
  const [selectedId, setSelectedId] = useState<string | null>(modelId)
  const existing = models.find((m) => m.id === selectedId)

  const [draft, setDraft] = useState<ModelConfig>(existing ? { ...existing } : blank(activeKind))
  const [apiKey, setApiKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [remoteModels, setRemoteModels] = useState<string[] | null>(null)
  const baseline = useRef(fingerprint(existing ? { ...existing } : blank(activeKind)))

  const kind: ProjectKind = draft.kind ?? 'text'
  const isGen = kind !== 'text'
  const gen = draft.gen ?? emptyGenConfig()
  const caps = draft.caps ?? []
  const dirty = fingerprint(draft) !== baseline.current || keyTouched

  const close = () => setModal(null)
  const patch = (p: Partial<ModelConfig>) => setDraft((d) => ({ ...d, ...p }))
  const patchGen = (g: Partial<GenConfig>) =>
    setDraft((d) => ({ ...d, gen: { ...(d.gen ?? emptyGenConfig()), ...g } }))

  /** 切到另一个模型（或新建）—— 有未保存改动先问一句 */
  const selectModel = (id: string | null) => {
    if (id === selectedId) return
    if (dirty && !window.confirm('当前模型有未保存的修改，切走会丢弃。继续？')) return
    const next = id ? models.find((m) => m.id === id) : null
    const d = next ? { ...next } : blank(activeKind)
    setSelectedId(id)
    setDraft(d)
    baseline.current = fingerprint(d)
    setApiKey('')
    setKeyTouched(false)
    setResult(null)
    setRemoteModels(null)
  }

  // 外部换了 modelId（比如从别处点进来）时跟着走
  useEffect(() => {
    if (modelId !== null && modelId !== selectedId) selectModel(modelId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId])

  const setKind = (k: ProjectKind) =>
    setDraft((d) => ({
      ...d,
      kind: k,
      // 换类型时把不适用的能力项剔掉，免得留下看不见却生效的残留
      caps: (d.caps ?? []).filter((c) => MODEL_CAPS.find((x) => x.cap === c)?.kinds.includes(k)),
      gen: k === 'text' ? d.gen : (d.gen ?? emptyGenConfig()),
    }))

  const applyProfile = (id: string) => {
    const prof = PARAM_PROFILES.find((p) => p.id === id)
    if (!prof) return
    setDraft((d) => ({ ...d, kind: prof.kind, caps: [...prof.caps], capOptions: { ...prof.options } }))
    setResult({ ok: true, message: prof.note })
  }

  const patchOptions = (o: Partial<CapOptions>) =>
    setDraft((d) => ({ ...d, capOptions: { ...(d.capOptions ?? {}), ...o } }))

  /** 逗号/空格分隔的取值列表 <-> 数组 */
  const listText = (v?: string[]) => (v ?? []).join(', ')
  const parseList = (t: string) => {
    const arr = t.split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean)
    return arr.length ? arr : undefined
  }

  const toggleCap = (cap: ModelCap) =>
    setDraft((d) => {
      const cur = d.caps ?? []
      return { ...d, caps: cur.includes(cap) ? cur.filter((c) => c !== cap) : [...cur, cap] }
    })

  const applyProvider = (label: string) => {
    const preset = PROVIDER_PRESETS.find((p) => p.label === label)
    if (!preset) return
    patch({
      baseURL: preset.baseURL,
      model: preset.models[0] && !preset.models[0].startsWith('填入') ? preset.models[0] : draft.model,
      name: draft.name || preset.label,
    })
    setRemoteModels(null)
  }

  const applyGenPreset = (label: string) => {
    const preset = GEN_PRESETS.find((p) => p.label === label)
    if (!preset) return
    setDraft((d) => ({
      ...d,
      kind: preset.kind,
      model: preset.model || d.model,
      name: d.name || preset.label,
      caps: preset.caps ? [...preset.caps] : (d.caps ?? []),
      gen: { ...preset.gen },
    }))
    setResult(preset.note ? { ok: true, message: preset.note } : null)
  }

  const canSave = isGen
    ? Boolean(draft.name.trim() && draft.model.trim() && gen.submitURL.trim() && gen.submitBody.trim())
    : Boolean(draft.name.trim() && draft.baseURL.trim() && draft.model.trim())

  /** 请求体模板是不是合法 JSON —— 占位符先替换成示例值再解析 */
  const bodyError = (() => {
    if (!isGen || !gen.submitBody.trim()) return null
    const probe = gen.submitBody
      .replace(/"?\{\{\s*(duration|seed)\s*\}\}"?/g, '4')
      .replace(/"?\{\{\s*(refs|assets)\s*\}\}"?/g, '[]')
      .replace(/\{\{\s*\w+\s*\}\}/g, 'x')
    try {
      JSON.parse(probe)
      return null
    } catch (err) {
      return (err as Error).message
    }
  })()

  const save = async () => {
    if (!canSave) return
    const clean: ModelConfig = {
      ...draft,
      name: draft.name.trim(),
      baseURL: draft.baseURL.trim(),
      model: draft.model.trim(),
      caps: draft.caps ?? [],
      gen: isGen ? { ...gen, submitURL: gen.submitURL.trim(), pollURL: gen.pollURL.trim() } : undefined,
    }
    await upsertModel(clean, keyTouched ? apiKey.trim() : null)
    notify(existing ? `「${clean.name}」已更新` : `已添加模型「${clean.name}」`)
    // 留在弹窗里继续配下一个，别把用户踢出去
    setSelectedId(clean.id)
    baseline.current = fingerprint(clean)
    setApiKey('')
    setKeyTouched(false)
  }

  const test = async () => {
    setBusy(true)
    setResult(null)
    const res = await window.api.testModel({
      modelId: draft.id,
      baseURL: draft.baseURL.trim(),
      model: draft.model.trim(),
      apiKey: keyTouched ? apiKey.trim() : undefined,
    })
    setResult({ ok: res.ok, message: res.message ?? '' })
    setBusy(false)
  }

  const fetchModels = async () => {
    setBusy(true)
    setResult(null)
    const res = await window.api.listModels({
      modelId: draft.id,
      baseURL: draft.baseURL.trim(),
      apiKey: keyTouched ? apiKey.trim() : undefined,
    })
    if (res.ok && res.models?.length) {
      setRemoteModels(res.models)
      setResult({ ok: true, message: `拉到 ${res.models.length} 个可用模型` })
    } else {
      setResult({ ok: false, message: res.message ?? '该服务商没有返回模型列表，手动填模型 ID 即可' })
    }
    setBusy(false)
  }

  const del = async (target: ModelConfig) => {
    if (!window.confirm(`删除模型「${target.name}」？已保存的 API Key 会一并清除，绑了它的窗口会变成未选择。`)) return
    await removeModel(target.id)
    notify(`已删除「${target.name}」`)
    if (target.id === selectedId) {
      const rest = models.filter((m) => m.id !== target.id)
      const next = rest.find((m) => (m.kind ?? 'text') === kind) ?? rest[0] ?? null
      setSelectedId(next?.id ?? null)
      const d = next ? { ...next } : blank(activeKind)
      setDraft(d)
      baseline.current = fingerprint(d)
      setApiKey('')
      setKeyTouched(false)
    }
  }

  // 左侧导航：按类型分组
  const grouped = useMemo(
    () =>
      PROJECT_KINDS.map((k) => ({
        ...k,
        items: models.filter((m) => (m.kind ?? 'text') === k.kind),
      })),
    [models],
  )

  const capsForKind = MODEL_CAPS.filter((c) => c.kinds.includes(kind))

  return (
    <Modal
      title="配置模型"
      onClose={close}
      wide
      tall
      footer={
        <>
          {existing && (
            <button className="btn danger" onClick={() => del(existing)}>
              <IconTrash width={12} height={12} />
              删除这个模型
            </button>
          )}
          {!isGen && (
            <button className="btn" onClick={test} disabled={busy || !canSave}>
              {busy ? '测试中…' : '测试连接'}
            </button>
          )}
          <div className="spacer" />
          <button className="btn" onClick={close}>
            关闭
          </button>
          <button className="btn primary" onClick={save} disabled={!canSave || !!bodyError || !dirty}>
            {existing ? '保存修改' : '添加'}
          </button>
        </>
      }
    >
      <div className="model-manager">
        {/* ---------- 左：模型导航 ---------- */}
        <nav className="model-nav">
          <button
            className={selectedId === null ? 'model-nav-new active' : 'model-nav-new'}
            onClick={() => selectModel(null)}
          >
            <IconPlus width={12} height={12} />
            新建模型
          </button>

          {models.length === 0 ? (
            <div className="empty-note">还没有任何模型</div>
          ) : (
            grouped.map((g) => (
              <div key={g.kind} className="model-nav-group">
                <div className="model-nav-title">
                  {g.label}
                  <span className="model-nav-count">{g.items.length}</span>
                </div>
                {g.items.length === 0 ? (
                  <div className="model-nav-empty">—</div>
                ) : (
                  g.items.map((m) => (
                    <div
                      key={m.id}
                      className={m.id === selectedId ? 'model-nav-item active' : 'model-nav-item'}
                      onClick={() => selectModel(m.id)}
                      title={`${m.model}${m.hasKey ? '' : ' · 缺少 API Key'}`}
                    >
                      <span className={m.hasKey ? 'dot ok' : 'dot warn'} />
                      <span className="model-nav-body">
                        <span className="model-nav-name">{m.name}</span>
                        <span className="model-nav-sub">{m.model}</span>
                      </span>
                      <button
                        className="icon-btn"
                        title="删除这个模型"
                        onClick={(e) => {
                          e.stopPropagation()
                          void del(m)
                        }}
                      >
                        <IconTrash width={11} height={11} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            ))
          )}
        </nav>

        {/* ---------- 右：配置表单 ---------- */}
        <div className="model-form">
          <div className="field">
            <label>模型类型</label>
            <div className="seg">
              {PROJECT_KINDS.map((k) => (
                <button
                  key={k.kind}
                  className={kind === k.kind ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => setKind(k.kind)}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label>显示名称</label>
              <input
                className="input"
                value={draft.name}
                placeholder={isGen ? '例如 Seedance 快速版' : '例如 DeepSeek-V3'}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </div>
            <div className="field">
              <label>模型 ID</label>
              <input
                className="input"
                value={draft.model}
                placeholder={isGen ? '例如 bytedance/seedance-2-0-fast' : '例如 deepseek-chat'}
                list="remote-models"
                onChange={(e) => patch({ model: e.target.value })}
              />
              {remoteModels && (
                <datalist id="remote-models">
                  {remoteModels.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              )}
              <div className="hint">
                {!isGen && (
                  <>
                    {' · '}
                    <button
                      className="btn sm ghost"
                      style={{ height: 18, padding: '0 4px' }}
                      onClick={fetchModels}
                      disabled={busy || !draft.baseURL.trim()}
                    >
                      拉取可用列表
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {!isGen && (
            <>
              <div className="field">
                <label>服务商模板</label>
                <Dropdown
                  value=""
                  placeholder="选一个自动填 Base URL…"
                  options={PROVIDER_PRESETS.map((p) => ({ value: p.label, label: p.label, sub: p.baseURL }))}
                  onChange={applyProvider}
                />
              </div>

              <div className="field">
                <label>Base URL</label>
                <input
                  className="input"
                  value={draft.baseURL}
                  placeholder="https://api.deepseek.com/v1"
                  onChange={(e) => patch({ baseURL: e.target.value })}
                />
              </div>
            </>
          )}

          <div className="field">
            <label>API Key</label>
            <input
              className="input"
              type="password"
              value={apiKey}
              placeholder={existing?.hasKey && !keyTouched ? '已保存（留空表示不修改）' : 'sk-…'}
              onChange={(e) => {
                setApiKey(e.target.value)
                setKeyTouched(true)
              }}
            />
          </div>

          {/* ---------- 能力项 ---------- */}
          {capsForKind.length > 0 && (
            <div className="field">
              <label>支持的能力</label>
              <div className="caps">
                {capsForKind.map((c) => (
                  <button
                    key={c.cap}
                    className={caps.includes(c.cap) ? 'cap on' : 'cap'}
                    onClick={() => toggleCap(c.cap)}
                    title={c.hint}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <div className="profile-row">
                <Dropdown
                  value=""
                  placeholder="套用一份参数档案…"
                  options={PARAM_PROFILES.filter((p) => p.kind === kind).map((p) => ({
                    value: p.id,
                    label: p.label,
                    sub: p.note,
                  }))}
                  onChange={applyProfile}
                />
              </div>
            </div>
          )}

          {isGen && caps.length > 0 && (
            <div className="field">
              <label>参数取值范围</label>
              <div className="grid-2">
                {caps.includes('duration') && (
                  <div className="field">
                    <label className="sub-label">时长（秒）</label>
                    <div className="range-row">
                      <input
                        className="input"
                        type="number"
                        min="1"
                        value={draft.capOptions?.durationMin ?? ''}
                        placeholder="最小"
                        onChange={(e) =>
                          patchOptions({ durationMin: e.target.value === '' ? undefined : Number(e.target.value) })
                        }
                      />
                      <span className="range-dash">–</span>
                      <input
                        className="input"
                        type="number"
                        min="1"
                        value={draft.capOptions?.durationMax ?? ''}
                        placeholder="最大"
                        onChange={(e) =>
                          patchOptions({ durationMax: e.target.value === '' ? undefined : Number(e.target.value) })
                        }
                      />
                    </div>
                  </div>
                )}
                {caps.includes('duration') && (
                  <div className="field">
                    <label className="sub-label">单窗口布局下的上限</label>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      value={draft.capOptions?.durationMaxSolo ?? ''}
                      placeholder="留空 = 和上面一样"
                      onChange={(e) =>
                        patchOptions({ durationMaxSolo: e.target.value === '' ? undefined : Number(e.target.value) })
                      }
                    />
                  </div>
                )}
                {(caps.includes('refImage') || caps.includes('assets')) && (
                  <div className="field">
                    <label className="sub-label">参考图最多几张</label>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      value={draft.capOptions?.refMax ?? ''}
                      placeholder="留空 = 不限"
                      onChange={(e) =>
                        patchOptions({ refMax: e.target.value === '' ? undefined : Number(e.target.value) })
                      }
                    />
                  </div>
                )}
              </div>
              {(['ratio', 'resolution', 'size'] as const)
                .filter((k) => caps.includes(k))
                .map((k) => (
                  <div className="field" key={k}>
                    <label className="sub-label">
                      {k === 'ratio' ? '可选比例' : k === 'resolution' ? '可选清晰度' : '可选尺寸'}
                    </label>
                    <input
                      className="input mono"
                      value={listText(draft.capOptions?.[k])}
                      placeholder="逗号分隔，留空 = 不限制"
                      onChange={(e) => patchOptions({ [k]: parseList(e.target.value) })}
                    />
                  </div>
                ))}
            </div>
          )}

          {isGen ? (
            <>
              <div className="field">
                <label>适配预设</label>
                <Dropdown
                  value=""
                  placeholder="选一个自动填…"
                  options={GEN_PRESETS.map((p) => ({ value: p.label, label: p.label, sub: p.note }))}
                  onChange={applyGenPreset}
                />
              </div>

              <div className="field">
                <label>提交地址</label>
                <input
                  className="input"
                  value={gen.submitURL}
                  placeholder="https://.../v1/videos/async_generations"
                  onChange={(e) => patchGen({ submitURL: e.target.value })}
                />
              </div>

              <div className="field">
                <label>请求体模板（JSON）</label>
                <textarea
                  className="textarea mono"
                  rows={9}
                  value={gen.submitBody}
                  onChange={(e) => patchGen({ submitBody: e.target.value })}
                />
                {bodyError && <div className="result err">请求体不是合法 JSON：{bodyError}</div>}
              </div>

              <div className="field">
                <label>轮询地址</label>
                <input
                  className="input"
                  value={gen.pollURL}
                  placeholder="用 {{id}} 占位任务 id；留空 = 提交即出结果，不轮询"
                  onChange={(e) => patchGen({ pollURL: e.target.value })}
                />
              </div>

              {gen.pollURL.trim() && (
                <>
                  <div className="grid-2">
                    <div className="field">
                      <label>轮询间隔（秒）</label>
                      <input
                        className="input"
                        type="number"
                        min="1"
                        value={Math.round((gen.pollIntervalMs || 3000) / 1000)}
                        onChange={(e) => patchGen({ pollIntervalMs: Math.max(1, Number(e.target.value) || 3) * 1000 })}
                      />
                    </div>
                    <div className="field">
                      <label>超时（秒）</label>
                      <input
                        className="input"
                        type="number"
                        min="10"
                        value={Math.round((gen.timeoutMs || 300000) / 1000)}
                        onChange={(e) => patchGen({ timeoutMs: Math.max(10, Number(e.target.value) || 300) * 1000 })}
                      />
                    </div>
                  </div>

                  <div className="grid-2">
                    <div className="field">
                      <label>任务 id 路径</label>
                      <input
                        className="input mono"
                        value={gen.idPath}
                        placeholder="data.id"
                        onChange={(e) => patchGen({ idPath: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label>状态路径</label>
                      <input
                        className="input mono"
                        value={gen.statusPath}
                        placeholder="data.status"
                        onChange={(e) => patchGen({ statusPath: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="grid-2">
                    <div className="field">
                      <label>成功状态值</label>
                      <input
                        className="input mono"
                        value={gen.successValues}
                        placeholder="succeeded,succeed,success"
                        onChange={(e) => patchGen({ successValues: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label>失败状态值</label>
                      <input
                        className="input mono"
                        value={gen.failValues}
                        placeholder="failed,error"
                        onChange={(e) => patchGen({ failValues: e.target.value })}
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="grid-2">
                <div className="field">
                  <label>结果地址路径</label>
                  <input
                    className="input mono"
                    value={gen.resultPath}
                    placeholder="data.url"
                    onChange={(e) => patchGen({ resultPath: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>失败原因路径</label>
                  <input
                    className="input mono"
                    value={gen.errorPath}
                    placeholder="error.message（可选）"
                    onChange={(e) => patchGen({ errorPath: e.target.value })}
                  />
                </div>
              </div>

              <div className="field">
                <label>价格</label>
                <div className="grid-2">
                  <div className="field">
                    <label className="sub-label">金额路径（元）</label>
                    <input
                      className="input mono"
                      value={gen.pricePath}
                      placeholder="usage.amount"
                      onChange={(e) => patchGen({ pricePath: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label className="sub-label">消耗量路径</label>
                    <input
                      className="input mono"
                      value={gen.creditsPath}
                      placeholder="data.extra_data.credits"
                      onChange={(e) => patchGen({ creditsPath: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid-2">
                  <div className="field">
                    <label className="sub-label">每单位消耗多少元</label>
                    <input
                      className="input"
                      type="number"
                      step="0.001"
                      min="0"
                      value={gen.unitPrice ?? ''}
                      placeholder="留空 = 只看金额路径"
                      onChange={(e) => patchGen({ unitPrice: e.target.value === '' ? null : Number(e.target.value) })}
                    />
                  </div>
                  <div className="field">
                    <label className="sub-label">实际时长路径</label>
                    <input
                      className="input mono"
                      value={gen.durationPath}
                      placeholder="data.extra_data.duration"
                      onChange={(e) => patchGen({ durationPath: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="grid-2">
                <div className="field">
                  <label title="o 系列 / Claude thinking / R1 这类模型有效，越高想得越久也越贵">推理强度</label>
                  <Dropdown
                    value={draft.reasoningEffort ?? ''}
                    placeholder="不传（用服务端默认）"
                    options={[
                      { value: '', label: '不传（用服务端默认）', sub: '请求里不带 reasoning_effort' },
                      ...REASONING_EFFORTS.map((r) => ({
                        value: r.value,
                        label: r.label,
                        sub: `reasoning_effort: ${r.value}`,
                      })),
                    ]}
                    onChange={(v) => patch({ reasoningEffort: v === '' ? null : (v as 'low' | 'medium' | 'high') })}
                  />
                </div>
                <div className="field">
                  <label>Temperature</label>
                  <input
                    className="input"
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={draft.temperature ?? ''}
                    placeholder="留空 = 用服务端默认"
                    onChange={(e) => patch({ temperature: e.target.value === '' ? null : Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="field">
                <label>Max tokens</label>
                <input
                  className="input"
                  type="number"
                  min="1"
                  value={draft.maxTokens ?? ''}
                  placeholder="留空 = 用服务端默认"
                  onChange={(e) => patch({ maxTokens: e.target.value === '' ? null : Number(e.target.value) })}
                />
              </div>

              <div className="field">
                <label title="模型级默认值；窗口里改动不会覆盖它，除非点「存为该模型默认」">该模型的默认 System Prompt</label>
                <textarea
                  className="textarea"
                  rows={4}
                  value={draft.systemPrompt}
                  placeholder="留空则不设。窗口切到这个模型时会自动带出这段提示词。"
                  onChange={(e) => patch({ systemPrompt: e.target.value })}
                />
              </div>
            </>
          )}

          {result && <div className={result.ok ? 'result ok' : 'result err'}>{result.message}</div>}
        </div>
      </div>
    </Modal>
  )
}
