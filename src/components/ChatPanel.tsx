import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { useActiveProject, useLayout, useStore } from '../store'
import type { Message, Panel } from '../types'
import { Markdown } from './Markdown'
import { Dropdown } from './Dropdown'
import { defaultModeFor, modeById, modeSupported, modesFor } from '../lib/genModes'
import {
  IconCollapse,
  IconCopy,
  IconExpand,
  IconPower,
  IconRefresh,
  IconSparkle,
  IconStop,
  IconTrash,
} from './Icons'
import { money } from '../lib/money'


function formatMeta(msg: Message) {
  const bits: string[] = []
  if (msg.modelLabel) bits.push(msg.modelLabel)
  if (msg.elapsedMs) bits.push(`${(msg.elapsedMs / 1000).toFixed(1)}s`)
  const out = msg.usage?.completion_tokens
  if (out) bits.push(`${out} tok`)
  return bits.join(' · ')
}

/** 生成结果：视频播放器 / 图片 + 花费 */
function GenResult({ msg }: { msg: Message }) {
  const notify = useStore((s) => s.notify)
  const media = msg.media
  if (!media) return null

  // 已下载到本地就优先用本地文件 —— API 给的链接通常 24 小时就失效。
  // 走 thmedia:// 自定义协议：开发模式下页面来自 http://，直接 file:// 会被
  // Chromium 的 URL safety check 拒掉（文件在、播放器黑屏）。
  // 本地文件可能被用户在访达里删掉 —— 加载失败就退回原始链接，两头都失效才报。
  const baseName = media.localPath?.match(/[^/\\]+$/)?.[0]
  const [fallback, setFallback] = useState(false)
  const [dead, setDead] = useState(false)
  const src = baseName && !fallback ? `thmedia://${encodeURIComponent(baseName)}` : media.url
  const onMediaError = () => {
    if (baseName && !fallback) setFallback(true)
    else setDead(true)
  }
  const c = msg.cost

  return (
    <div className="gen-result">
      {dead ? (
        <div className="gen-media-gone">本地文件已被删除，原始链接也已失效（生成类链接一般 24 小时过期）</div>
      ) : media.kind === 'video' ? (
        <video key={src} className="gen-media" src={src} controls preload="metadata" onError={onMediaError} />
      ) : (
        <img key={src} className="gen-media" src={src} alt="" onError={onMediaError} />
      )}
      {fallback && !dead && (
        <div className="msg-meta">本地文件不在了，正在用原始链接播放 —— 该链接通常 24 小时后失效</div>
      )}

      <div className="gen-meta">
        {c?.amount != null ? (
          <>
            <span className="price">¥{money(c.amount)}</span>
            {c.perSecond != null && <span className="price-sub">¥{money(c.perSecond)}/秒</span>}
            {msg.elapsedMs ? <span className="gen-time">用时 {(msg.elapsedMs / 1000).toFixed(1)}s</span> : null}
            {c.source === 'credits' && c.credits != null && (
              <span className="price-sub" title="接口没返回金额，按消耗量 × 单价换算">
                {c.credits} 单位换算
              </span>
            )}
          </>
        ) : (
          <>
            <span className="price-sub" title="接口没返回金额，也没配单价换算">
              价格未知
            </span>
            {msg.elapsedMs ? <span className="gen-time">用时 {(msg.elapsedMs / 1000).toFixed(1)}s</span> : null}
          </>
        )}

        <div className="spacer" />

        {media.localPath ? (
          <>
            <button className="btn sm ghost" onClick={() => void window.api.openPath(media.localPath!)}>
              打开
            </button>
            <button className="btn sm ghost" onClick={() => void window.api.revealPath(media.localPath!)}>
              在访达中显示
            </button>
          </>
        ) : (
          <button
            className="btn sm ghost"
            onClick={() => {
              void window.api.openExternal(media.url)
              notify('已在浏览器打开 —— 这个链接通常 24 小时后失效')
            }}
          >
            打开原链接
          </button>
        )}
      </div>
    </div>
  )
}

function AssistantMessage({
  msg,
  streaming,
  progress,
}: {
  msg: Message
  streaming: boolean
  progress?: string | null
}) {
  const meta = formatMeta(msg)
  const isGen = !!msg.media || !!msg.cost || !!msg.genParams
  return (
    <div className="msg-assistant">
      {isGen && streaming && <div className="gen-progress">{progress ?? '生成中…'}</div>}
      {msg.media && <GenResult msg={msg} />}
      {msg.reasoning ? (
        <details className="reasoning" open={streaming && !msg.content}>
          <summary>思考过程 · {msg.reasoning.length} 字</summary>
          <div className="reasoning-body">{msg.reasoning}</div>
        </details>
      ) : null}

      {msg.content ? <Markdown text={msg.content} /> : null}
      {streaming && !isGen ? <span className="caret" /> : null}

      {msg.error ? <div className="msg-error">{msg.error}</div> : null}
      {msg.aborted ? <div className="msg-meta">已手动停止</div> : null}
      {/* 生成类不重复模型名：窗口标题已有；用时在价格行里 */}
      {!streaming && meta && !isGen ? <div className="msg-meta">{meta}</div> : null}
    </div>
  )
}

interface PanelProps {
  panel: Panel
  index: number
  /** 右侧列里的缩略形态 */
  mini?: boolean
  /** 当前是否是聚焦模式下的主窗口 */
  focused?: boolean
}

export function ChatPanel({ panel, index, mini = false, focused = false }: PanelProps) {
  const allModels = useStore((s) => s.models)
  const project = useActiveProject()
  const projectKind = project.kind ?? 'text'
  // 只列同类型的模型 —— 文本模型没法拿来生成视频
  const sameKind = allModels.filter((m) => (m.kind ?? 'text') === projectKind)
  // 再按当前生成模式过滤：撑不起这个模式的模型不出现在下拉里，
  // 免得选了才发现不支持（每次生成都是真花钱）
  const mode =
    projectKind === 'text'
      ? undefined
      : (modeById(project.genMode ?? defaultModeFor(projectKind)) ?? modesFor(projectKind)[0])
  const models = sameKind.filter((m) => modeSupported(m.caps, mode))
  const bound = allModels.find((m) => m.id === panel.modelId)
  // 已经绑上的模型如果撑不起当前模式，不悄悄摘掉 —— 标红让用户自己决定
  const modeMismatch = Boolean(bound) && !modeSupported(bound?.caps, mode)
  const layout = useLayout()
  const setPanelModel = useStore((s) => s.setPanelModel)
  const togglePanel = useStore((s) => s.togglePanel)
  const clearPanel = useStore((s) => s.clearPanel)
  const stopPanel = useStore((s) => s.stopPanel)
  const retryPanel = useStore((s) => s.retryPanel)
  const toggleFocus = useStore((s) => s.toggleFocus)
  const setModal = useStore((s) => s.setModal)
  const notify = useStore((s) => s.notify)

  const bodyRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  // 只有用户没往上翻的时候才自动贴底
  const onScroll = () => {
    const el = bodyRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [panel.messages])

  useEffect(() => {
    stickRef.current = true
  }, [panel.messages.length])

  const streaming = panel.status === 'streaming'
  const hasSystemPrompt = panel.systemPrompt.trim().length > 0

  const copyAll = async () => {
    const text = panel.messages
      .map((m) => `${m.role === 'user' ? '### 我' : `### ${m.modelLabel ?? '模型'}`}\n${m.content}`)
      .join('\n\n')
    await navigator.clipboard.writeText(text)
    notify('已复制该窗口的对话')
  }

  const canFocus = layout > 1

  // 双击标题栏放大/还原，但别把下拉框和按钮的双击也算上
  const onHeadDoubleClick = (e: MouseEvent) => {
    if (!canFocus) return
    if ((e.target as HTMLElement).closest('select, button')) return
    toggleFocus(panel.id)
  }

  return (
    <section
      className={[
        'panel',
        streaming ? 'streaming' : '',
        panel.status === 'error' ? 'errored' : '',
        modeMismatch ? 'mode-bad' : '',
        panel.enabled ? '' : 'off',
        mini ? 'mini' : '',
        focused ? 'focused' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div
        className="panel-head"
        onDoubleClick={onHeadDoubleClick}
        title={canFocus ? '双击标题栏放大 / 还原' : undefined}
      >
        <Dropdown
          className={panel.modelId ? 'panel-model' : 'panel-model unset'}
          value={panel.modelId ?? ''}
          placeholder={`窗口 ${index + 1} · 选择模型`}
          title={models.find((m) => m.id === panel.modelId)?.model ?? '未选择模型'}
          options={[
            { value: '', label: `窗口 ${index + 1} · 选择模型` },
            ...models.map((m) => ({
              value: m.id,
              label: m.name,
              sub: m.hasKey ? m.model : `${m.model} · 缺少 API Key`,
            })),
            // 当前绑的这个不支持该模式，也得留在列表里，否则下拉显示不出名字
            ...(modeMismatch && bound
              ? [{ value: bound.id, label: bound.name, sub: `不支持「${mode?.label}」`, group: '不支持当前模式' }]
              : []),
          ]}
          onChange={(v) => setPanelModel(panel.id, v || null)}
        />

        {projectKind === 'text' && (
          <button
            className={hasSystemPrompt ? 'sp-chip on' : 'sp-chip'}
            onClick={() => setModal({ type: 'systemPrompt', panelId: panel.id })}
            title={hasSystemPrompt ? panel.systemPrompt : '为这个窗口设置 system prompt'}
          >
            <IconSparkle width={11} height={11} />
            SP
          </button>
        )}

        <div className="spacer" />

        <div className="panel-actions">
          <button
            className={panel.enabled ? 'icon-btn active' : 'icon-btn'}
            onClick={() => togglePanel(panel.id)}
            title={panel.enabled ? '已加入群发（点击排除）' : '已排除群发（点击加入）'}
          >
            <IconPower width={13} height={13} />
          </button>
          {streaming ? (
            <button className="icon-btn" onClick={() => stopPanel(panel.id)} title="停止">
              <IconStop width={12} height={12} />
            </button>
          ) : (
            <button
              className="icon-btn mini-hide"
              onClick={() => retryPanel(panel.id)}
              disabled={projectKind !== 'text' || !panel.messages.some((m) => m.role === 'user')}
              title={
                projectKind === 'text'
                  ? '用同样的问题重新生成'
                  : '生成类不做一键重试 —— 每次都要真实计费，请在下方重新点「生成」'
              }
            >
              <IconRefresh width={13} height={13} />
            </button>
          )}
          <button
            className="icon-btn mini-hide"
            onClick={copyAll}
            disabled={panel.messages.length === 0}
            title="复制对话"
          >
            <IconCopy width={13} height={13} />
          </button>
          <button
            className="icon-btn mini-hide"
            onClick={() => clearPanel(panel.id)}
            disabled={panel.messages.length === 0}
            title="清空该窗口"
          >
            <IconTrash width={13} height={13} />
          </button>
          {canFocus && (
            <button
              className={focused ? 'icon-btn active' : 'icon-btn'}
              onClick={() => toggleFocus(panel.id)}
              title={focused ? '还原为网格（Esc）' : '放大为主窗口'}
            >
              {focused ? <IconCollapse width={13} height={13} /> : <IconExpand width={13} height={13} />}
            </button>
          )}
        </div>
      </div>

      {modeMismatch && (
        <div className="mode-warn" title="换个模型，或把生成模式换回它支持的那种">
          {bound?.name} 不支持「{mode?.label}」
        </div>
      )}

      <div className="panel-body" ref={bodyRef} onScroll={onScroll}>
        {panel.messages.length === 0 ? (
          <div className="panel-empty">
            {panel.modelId ? (
              <>
                {projectKind === 'text'
                  ? hasSystemPrompt
                    ? '已加载 system prompt'
                    : '未设置 system prompt'
                  : projectKind === 'video'
                    ? '视频生成 · 按次计费'
                    : '图像生成 · 按次计费'}
                <br />
                在下方输入提示词开始
              </>
            ) : models.length === 0 ? (
              <>
                还没有{projectKind === 'text' ? '文本' : projectKind === 'video' ? '视频' : '图像'}模型
                <br />
                在侧栏「+ 添加模型」里加一个
              </>
            ) : (
              <>
                这个窗口还没绑定模型
                <br />
                点上方下拉框选一个
              </>
            )}
          </div>
        ) : (
          panel.messages.map((msg) =>
            msg.role === 'user' ? (
              <div className="msg-user" key={msg.id}>
                {msg.content}
              </div>
            ) : (
              <AssistantMessage
                key={msg.id}
                msg={msg}
                streaming={streaming && msg.id === panel.streamingMessageId}
                progress={panel.progress}
              />
            ),
          )
        )}
      </div>
    </section>
  )
}
