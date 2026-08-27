import { useEffect, useRef, useState } from 'react'
import { useActiveProject, useLayout, usePanels, useStore } from '../store'
import { ASSET_KINDS, type Asset, type AssetKind, type ModelCap } from '../types'
import { Dropdown } from './Dropdown'
import { SlotCard } from './SlotCard'
import { RefAssets } from './RefAssets'
import { defaultModeFor, missingSlots, modeById, modesFor, modeSupported } from '../lib/genModes'
import { DurationPicker } from './DurationPicker'
import {
  IconBroadcast,
  IconCollapse,
  IconExpand,
  IconFrame,
  IconModeFrames,
  IconModeImage,
  IconModeRef,
  IconModeText,
  IconSend,
  IconStop,
  IconSwap,
} from './Icons'

const MODE_ICONS: Record<string, JSX.Element> = {
  text: <IconModeText width={15} height={15} />,
  image: <IconModeImage width={15} height={15} />,
  frames: <IconModeFrames width={15} height={15} />,
  ref: <IconModeRef width={15} height={15} />,
}

/** 一张图的选取结果 */
interface Picked {
  path: string
  name: string
  dataUrl: string
}

export function Composer() {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  // 输入区展开：向上盖在窗口网格上，不推挤布局。
  // 展开时外壳冻结在收起时的高度，里面的卡片转为绝对定位往上长。
  const wrapRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [holdH, setHoldH] = useState<number | null>(null)
  const toggleExpand = () => {
    if (!expanded) {
      setHoldH(wrapRef.current?.offsetHeight ?? null)
      setExpanded(true)
    } else {
      setExpanded(false)
      setHoldH(null)
    }
  }

  const send = useStore((s) => s.send)
  const stopAll = useStore((s) => s.stopAll)
  const notify = useStore((s) => s.notify)
  const setGenParams = useStore((s) => s.setGenParams)
  const models = useStore((s) => s.models)
  const layout = useLayout()
  const panels = usePanels()
  const project = useActiveProject()

  const kind = project.kind ?? 'text'
  const isGen = kind !== 'text'
  const params = project.genParams ?? {}

  const visible = panels.slice(0, layout)
  const targets = visible.filter((p) => p.enabled && p.modelId)
  const busy = visible.some((p) => p.status === 'streaming')

  // 本地选图状态（路径存进 genParams，缩略图只留在内存）
  const [thumbs, setThumbs] = useState<Record<string, string>>({})

  // 换项目时清掉上一个项目残留的缩略图
  useEffect(() => {
    setThumbs({})
  }, [project.id])

  // 当前这些窗口的模型，合起来支持哪些能力 —— 只显示真正会生效的控件
  const setGenMode = useStore((s) => s.setGenMode)
  const modes = modesFor(kind)
  const modeId = project.genMode ?? defaultModeFor(kind)
  const mode = modeById(modeId) ?? modes[0]

  const capSet = new Set<ModelCap>()
  for (const p of visible) {
    const m = p.modelId ? models.find((x) => x.id === p.modelId) : null
    for (const c of m?.caps ?? []) capSet.add(c)
  }
  const anyBound = visible.some((p) => p.modelId)
  const has = (c: ModelCap) => capSet.has(c)
  const showParams = isGen && anyBound && capSet.size > 0

  // 参数条是全项目共用的一套值，但每个窗口的模型允许的取值不一样。
  // 取交集：发出去的值对每个绑定的模型都合法，不会白花一次钱。
  const boundModels = visible.map((p) => (p.modelId ? models.find((x) => x.id === p.modelId) : null)).filter(Boolean)
  /**
   * 各家的取值几乎不重叠（Seedream 的 2K/4K、Gemini 的 1408x768、GPT 的 auto），
   * 取交集会把选项饿死到只剩 1024x1024。所以列并集，
   * 不被所有模型支持的值标出来是谁不认，发送时再拦真正的冲突。
   */
  const optsFor = (key: 'ratio' | 'resolution' | 'size'): { value: string; missing: string[] }[] => {
    const withList = boundModels.filter((m) => (m!.capOptions?.[key]?.length ?? 0) > 0)
    if (withList.length === 0) return []
    const union = [...new Set(withList.flatMap((m) => m!.capOptions![key]!))]
    return union.map((value) => ({
      value,
      missing: withList.filter((m) => !m!.capOptions![key]!.includes(value)).map((m) => m!.name),
    }))
  }

  /** 已选的值有哪些窗口的模型不认（有取值表且不含它的才算） */
  const conflictOf = (key: 'ratio' | 'resolution' | 'size'): string[] => {
    const v = params[key]
    if (!v) return []
    return boundModels
      .filter((m) => (m!.capOptions?.[key]?.length ?? 0) > 0 && !m!.capOptions![key]!.includes(v))
      .map((m) => m!.name)
  }
  // 单窗口布局下才用 solo 上限（长视频慢且贵，对比模式统一到常规上限）
  const solo = layout === 1
  const durRange = (() => {
    const mins = boundModels.map((m) => m!.capOptions?.durationMin).filter((v): v is number => typeof v === 'number')
    const maxs = boundModels
      .map((m) => (solo ? (m!.capOptions?.durationMaxSolo ?? m!.capOptions?.durationMax) : m!.capOptions?.durationMax))
      .filter((v): v is number => typeof v === 'number')
    return { min: mins.length ? Math.max(...mins) : 1, max: maxs.length ? Math.min(...maxs) : 60 }
  })()
  // 有模型在单窗口下能跑更长 —— 越界时提示里点出来，别让人以为是坏了
  const soloWouldAllow = !solo
    ? Math.min(
        ...boundModels
          .map((m) => m!.capOptions?.durationMaxSolo ?? m!.capOptions?.durationMax)
          .filter((v): v is number => typeof v === 'number'),
        Infinity,
      )
    : Infinity

  const ratioOpts = optsFor('ratio')
  const resOpts = optsFor('resolution')
  const sizeOpts = optsFor('size')
  const optToItem = (o: { value: string; missing: string[] }) => ({
    value: o.value,
    label: o.value,
    sub: o.missing.length ? `${o.missing.join('、')} 不支持` : undefined,
  })
  const durOut = params.duration != null && (params.duration < durRange.min || params.duration > durRange.max)

  // 自动撑高
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [text])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        ref.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pick = async (): Promise<Picked | null> => await window.api.pickImage()


  const setFrame = async (which: 'firstFrame' | 'lastFrame') => {
    const got = await pick()
    if (!got) return
    setThumbs((t) => ({ ...t, [got.path]: got.dataUrl }))
    setGenParams({ [which]: got.path })
  }

  // 素材按类型编号：模型是靠提示词里的 @Image1 / @Video1 / @Audio1 认它们的
  const LABEL_PREFIX: Record<AssetKind, string> = { image: 'Image', video: 'Video', audio: 'Audio' }
  const relabel = (list: Asset[]): Asset[] => {
    const n: Record<string, number> = {}
    return list.map((a) => {
      n[a.kind] = (n[a.kind] ?? 0) + 1
      return { ...a, label: `${LABEL_PREFIX[a.kind]}${n[a.kind]}` }
    })
  }
  const assetMax = (k: AssetKind) => {
    const key = k === 'image' ? 'assetMaxImage' : k === 'video' ? 'assetMaxVideo' : 'assetMaxAudio'
    const ns = boundModels.map((m) => m!.capOptions?.[key]).filter((v): v is number => typeof v === 'number')
    return ns.length ? Math.min(...ns) : Infinity
  }

  /** 不指定类型：给一个混合选择器，选完按扩展名归类 */
  const addAsset = async (kind: AssetKind | 'any' = 'any') => {
    const cur = params.assets ?? []
    const got = await window.api.pickImage(kind)
    if (!got) return
    const k = got.kind
    const label = ASSET_KINDS.find((x) => x.kind === k)?.label ?? k
    const max = assetMax(k)
    if (cur.filter((a) => a.kind === k).length >= max) {
      notify(`这些模型最多支持 ${max} 个${label}素材`, 'err')
      return
    }
    if (got.tooBig) {
      const mb = Math.round((got.size ?? 0) / 1024 / 1024)
      notify(`这个${label}有 ${mb}MB，塞不进请求体 —— 点卡片上的「地址」加一个公网 URL`, 'err')
      return
    }
    if (got.dataUrl) setThumbs((t) => ({ ...t, [got.path]: got.dataUrl }))
    setGenParams({ assets: relabel([...cur, { kind: k, path: got.path, label: '' }]) })
  }

  const addAssetUrl = () => {
    const url = window.prompt('粘贴参考素材的公网地址（图片 / 视频 / 音频，http 或 https）')?.trim()
    if (!url) return
    if (!/^https?:\/\//i.test(url)) {
      notify('要一个 http/https 开头的公网地址', 'err')
      return
    }
    // 按后缀归类，认不出就当图片
    const ext = (url.split('?')[0].match(/\.(\w+)$/)?.[1] ?? '').toLowerCase()
    const kind = (ASSET_KINDS.find((k) => k.exts.includes(ext))?.kind ?? 'image') as AssetKind
    setGenParams({ assets: relabel([...(params.assets ?? []), { kind, url, label: '' }]) })
  }

  const swapFrames = () =>
    setGenParams({ firstFrame: params.lastFrame, lastFrame: params.firstFrame })

  const removeAsset = (label: string) =>
    setGenParams({ assets: relabel((params.assets ?? []).filter((a) => a.label !== label)) })


  const submit = () => {
    if (!text.trim()) return
    if (targets.length === 0) {
      notify('没有可发送的窗口：先给窗口选模型，或打开群发开关', 'err')
      return
    }
    // 有窗口的模型撑不起当前模式 —— 发出去也是错的，先拦下
    const unsupported = targets.filter((p) => {
      const m = models.find((x) => x.id === p.modelId)
      return !modeSupported(m?.caps, mode)
    })
    if (unsupported.length > 0) {
      notify(`${unsupported.length} 个窗口的模型不支持「${mode?.label}」，换个模型或换个模式`, 'err')
      return
    }
    // 传了素材但有模型吃不下 —— 常规模式对纯文生开放，所以按「实际传了什么」查能力
    const capChecks: { has: boolean; cap: ModelCap; what: string }[] = [
      { has: !!params.firstFrame, cap: 'firstFrame', what: '参考图' },
      { has: !!params.lastFrame, cap: 'lastFrame', what: '尾帧' },
      { has: (params.refs?.length ?? 0) > 0 || (params.assets?.length ?? 0) > 0, cap: 'refImage', what: '参考素材' },
    ]
    for (const c of capChecks) {
      if (!c.has) continue
      const bad = targets
        .map((p) => models.find((m) => m.id === p.modelId))
        .filter((m) => m && !(m.caps ?? []).includes(c.cap))
        .map((m) => m!.name)
      if (bad.length > 0) {
        notify(`${bad.join('、')} 不支持${c.what}，去掉素材或把那个窗口移出群发`, 'err')
        return
      }
    }

    // 模式要的素材没给齐 —— 发出去也不是你要的结果
    const lack = missingSlots(mode, params)
    if (lack.length > 0) {
      notify(`「${mode?.label}」还缺：${lack.join('、')}`, 'err')
      return
    }
    // 选的比例/清晰度/尺寸有模型不认 —— 发出去那个窗口必失败
    for (const key of ['ratio', 'resolution', 'size'] as const) {
      const bad = conflictOf(key)
      if (bad.length > 0) {
        const label = key === 'ratio' ? '比例' : key === 'resolution' ? '清晰度' : '尺寸'
        notify(`${bad.join('、')} 不支持${label} ${params[key]}，换个值或把那个窗口移出群发`, 'err')
        return
      }
    }
    if (durOut) {
      const extra =
        Number.isFinite(soloWouldAllow) && soloWouldAllow > durRange.max
          ? `。切成单窗口布局最长可到 ${soloWouldAllow} 秒`
          : ''
      notify(`时长超出范围：这些模型只支持 ${durRange.min}–${durRange.max} 秒${extra}`, 'err')
      return
    }
    const count = send(text, { imagePath: params.refs?.[0] ?? params.firstFrame ?? null })
    if (count > 0) setText('')
  }

  // 发给几个窗口由窗口自己的绑定和开关决定，底栏的 n/m 已经在说了，这里不重复
  const placeholder = isGen ? `描述你想生成的${kind === 'video' ? '视频' : '图像'}…` : '输入提示词…'



  return (
    <div className="composer-wrap" ref={wrapRef} style={holdH != null ? { height: holdH } : undefined}>
      <div className={expanded ? 'composer expanded' : 'composer'}>
      <button
        className="composer-expand"
        onClick={toggleExpand}
        title={expanded ? '收起输入区' : '展开输入区（盖在窗口上，不挤压布局）'}
      >
        {expanded ? <IconCollapse width={13} height={13} /> : <IconExpand width={13} height={13} />}
      </button>
      <div className="composer-row">
      {/* 按当前模式摆素材卡片：文生视频没有槽位，首尾帧两张并排，全能参考可以加多个 */}
      {showParams && mode && mode.slots.length > 0 && (
        <div className="gen-slots">
          {mode.slots.map((slot, i) => {
            if (slot.field === 'firstFrame' || slot.field === 'lastFrame') {
              const path = params[slot.field]
              return (
                <span className="slot-pair" key={slot.field}>
                  {slot.swapWithPrev && (
                    <button className="slot-swap" onClick={swapFrames} title="互换首尾帧">
                      <IconSwap width={14} height={14} />
                    </button>
                  )}
                  <SlotCard
                    label={slot.label}
                    thumb={path ? thumbs[path] : undefined}
                    filled={path}
                    onPick={() => void setFrame(slot.field as 'firstFrame' | 'lastFrame')}
                    onClear={() => setGenParams({ [slot.field]: undefined })}
                  />
                </span>
              )
            }
            // 参考素材：三态组件 —— 空卡 / 叠放 / 展开面板
            return (
              <RefAssets
                key={`${slot.label}-${i}`}
                label={slot.label}
                assets={params.assets ?? []}
                thumbs={thumbs}
                onAdd={() => void addAsset()}
                onAddUrl={addAssetUrl}
                onRemove={removeAsset}
                onClear={() => setGenParams({ assets: [] })}
              />
            )
          })}
        </div>
      )}


      <textarea
        ref={ref}
        autoFocus
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
      />
      </div>
      <div className="composer-bar">
        {showParams && (
          <div className="gen-params">
            {/* 生成模式：决定上面出现哪些素材卡片，也决定哪些模型能用 */}
            {modes.length > 1 && (
              <Dropdown
                className="chip chip-mode"
                value={modeId}
                title={mode?.hint}
                options={modes.map((m) => ({
                  value: m.id,
                  label: m.label,
                  sub: m.hint,
                  icon: MODE_ICONS[m.icon],
                  badge: m.beta ? 'Beta' : undefined,
                }))}
                onChange={setGenMode}
              />
            )}

            {/* 画幅一组：比例 · 清晰度 · 尺寸 挤在一个胶囊里 */}
            {(has('ratio') || has('resolution') || has('size')) && (
              <div className="chip group">
                {has('ratio') && (
                  <>
                    <IconFrame width={13} height={13} />
                    <Dropdown
                      className="chip-dd"
                      value={params.ratio ?? ''}
                      placeholder="比例"
                      options={[
                        { value: '', label: '默认比例' },
                        ...ratioOpts.map(optToItem),
                      ]}
                      onChange={(v) => setGenParams({ ratio: v || undefined })}
                    />
                  </>
                )}
                {has('ratio') && has('resolution') && <i className="chip-sep" />}
                {has('resolution') && (
                  <Dropdown
                    className="chip-dd"
                    value={params.resolution ?? ''}
                    placeholder="清晰度"
                    options={[
                      {
                        value: '',
                        label: '默认',
                        sub: (() => {
                          // 直接展示各模型会用哪档，「默认」不再是黑盒
                          const pairs = boundModels
                            .filter((m) => m!.capOptions?.resolutionDefault)
                            .map((m) => `${m!.name} ${m!.capOptions!.resolutionDefault}`)
                          return pairs.length ? pairs.join(' · ') : '各窗口按模型默认档'
                        })(),
                      },
                      ...resOpts.map(optToItem),
                    ]}
                    onChange={(v) => setGenParams({ resolution: v || undefined })}
                  />
                )}
                {has('size') && (has('ratio') || has('resolution')) && <i className="chip-sep" />}
                {has('size') && (
                  <Dropdown
                    className="chip-dd wide"
                    value={params.size ?? ''}
                    placeholder="尺寸"
                    options={[
                      { value: '', label: '默认尺寸' },
                      ...sizeOpts.map(optToItem),
                    ]}
                    onChange={(v) => setGenParams({ size: v || undefined })}
                  />
                )}
              </div>
            )}

            {/* 时长 */}
            {has('duration') && (
              <DurationPicker
                value={params.duration}
                min={durRange.min}
                max={durRange.max}
                bad={durOut}
                soloMax={Number.isFinite(soloWouldAllow) && soloWouldAllow > durRange.max ? soloWouldAllow : undefined}
                onChange={(v) => setGenParams({ duration: v })}
              />
            )}

          </div>
        )}
        <div className="spacer" />
        <span className="composer-hint" title={`将发送到 ${targets.length} / ${visible.length} 个窗口`}>
          <IconBroadcast width={12} height={12} style={{ verticalAlign: -2, marginRight: 4 }} />
          <strong style={{ color: 'var(--text-2)' }}>{targets.length}</strong>/{visible.length}
        </span>
        {busy ? (
          <button className="send-btn stop" onClick={stopAll} title="全部停止">
            <IconStop width={14} height={14} />
          </button>
        ) : (
          <button
            className="send-btn"
            onClick={submit}
            disabled={!text.trim() || targets.length === 0}
            title={isGen ? '生成（Enter）' : '发送（Enter）'}
          >
            <IconSend width={16} height={16} />
          </button>
        )}
      </div>
      </div>
    </div>
  )
}
