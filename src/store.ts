import { create } from 'zustand'
import { profileFor } from './lib/paramProfiles'
import {
  MAX_PANELS,
  type ChatEvent,
  type LayoutCount,
  type Message,
  type ModalState,
  type ModelCap,
  type ModelConfig,
  type Panel,
  type PersistedState,
  type Project,
  type ProjectKind,
  type PromptPreset,
  type GenEvent,
} from './types'

export const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`

const now = () => Date.now()

function emptyPanel(index: number): Panel {
  return {
    id: `panel-${index + 1}`,
    modelId: null,
    systemPrompt: '',
    messages: [],
    status: 'idle',
    enabled: true,
    requestId: null,
    streamingMessageId: null,
    error: null,
  }
}

const defaultPanels = () => Array.from({ length: MAX_PANELS }, (_, i) => emptyPanel(i))

/** 'panel-3' -> 2 */
export const panelIndexOf = (panelId: string) => Number(panelId.split('-')[1] ?? 0) - 1

function makeProject(name: string, kind: ProjectKind, seed?: Partial<Project>): Project {
  return {
    id: uid(),
    name,
    kind,
    layout: 4,
    focusedPanelId: null,
    panels: defaultPanels(),
    ...seed,
    createdAt: now(),
    updatedAt: now(),
  }
}

/** 保留窗口的模型绑定和 system prompt，但清空对话 —— 新建项目时的默认行为 */
const withoutMessages = (panels: Panel[]): Panel[] =>
  panels.map((p) => ({
    ...p,
    messages: [],
    status: 'idle' as const,
    requestId: null,
    streamingMessageId: null,
    error: null,
  }))

const toRegistry = (models: ModelConfig[]) => models.map(({ hasKey: _k, ...rest }) => rest)

interface Store extends PersistedState {
  ready: boolean
  encryptionAvailable: boolean
  modal: ModalState
  toast: { id: string; text: string; tone: 'ok' | 'err' } | null

  hydrate: () => Promise<void>
  setTheme: (theme: 'dark' | 'light') => void
  setModal: (modal: ModalState) => void
  notify: (text: string, tone?: 'ok' | 'err') => void

  /* 项目 */
  /** 沿用当前项目的模型绑定与 system prompt，只清空对话。返回新项目 id 便于立刻改名 */
  /** 侧栏顶部的测试内容模块。项目列表按它筛选 */
  setActiveKind: (kind: ProjectKind) => void
  createProject: (name: string, kind?: ProjectKind) => string
  switchProject: (projectId: string) => void
  renameProject: (projectId: string, name: string) => void
  duplicateProject: (projectId: string) => void
  deleteProject: (projectId: string) => void

  /* 布局 / 聚焦 */
  setLayout: (layout: LayoutCount) => void
  toggleFocus: (panelId: string) => void
  clearFocus: () => void

  /* 模型（全局） */
  upsertModel: (model: ModelConfig, apiKey: string | null) => Promise<void>
  removeModel: (modelId: string) => Promise<void>

  /* 窗口 */
  setPanelModel: (panelId: string, modelId: string | null) => void
  togglePanel: (panelId: string) => void
  clearPanel: (panelId: string) => void
  clearAll: () => void

  /* system prompt */
  setPanelSystemPrompt: (panelId: string, text: string) => void
  syncSystemPromptToAll: (text: string) => void
  saveSystemPromptToModel: (panelId: string) => void
  applyPresetToPanel: (panelId: string, presetId: string) => void
  applyPresetToAll: (presetId: string) => void

  /* 提示词库（全局） */
  upsertPreset: (preset: PromptPreset) => void
  removePreset: (presetId: string) => void

  /** 图像/视频项目的生成参数 */
  /** 切换生成模式 */
  setGenMode: (id: string) => void
  setGenParams: (patch: Partial<NonNullable<Project['genParams']>>) => void

  /* 会话 */
  /** 文本项目发消息；图像/视频项目发起生成。imagePath 仅生成类用 */
  send: (text: string, opts?: { onlyPanelId?: string; imagePath?: string | null }) => number
  retryPanel: (panelId: string) => void
  stopPanel: (panelId: string) => void
  stopAll: () => void
}

/* -------------------------------------------------------------- *
 * 流式增量批处理：把 delta 攒到下一帧再合并进 state，
 * 否则 9 个窗口同时输出时每个 token 都会触发一次全量 render。
 * -------------------------------------------------------------- */
interface PendingChunk {
  content: string
  reasoning: string
}
const pending = new Map<string, PendingChunk>()
let rafHandle = 0

function bufferChunk(requestId: string, field: keyof PendingChunk, text: string) {
  const entry = pending.get(requestId) ?? { content: '', reasoning: '' }
  entry[field] += text
  pending.set(requestId, entry)
}

/**
 * 老存档的模型没有 caps 字段。直接当成「什么都不支持」会让输入区的参数行
 * 整个消失，所以从请求体模板里出现的占位符倒推一遍。
 */
function reviveCaps(m: ModelConfig): Partial<ModelConfig> {
  const kind = m.kind ?? 'text'

  // 认识这个模型的话直接套实测过的档案：能力项和取值范围一起给。
  // 只在还没配过的时候套，用户自己改过的不动。
  if (kind !== 'text' && !m.capOptions) {
    const prof = profileFor(m.model ?? '', kind)
    if (prof) {
      // 档案来自文档 + 实测，比从模板倒推的能力项准，直接采用
      return { caps: [...prof.caps], capOptions: { ...prof.options } }
    }
  }

  if (Array.isArray(m.caps)) return {}
  if (kind === 'text') return { caps: [] }
  const body = m.gen?.submitBody ?? ''
  const seen = (name: string) => new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`).test(body)
  const caps: ModelCap[] = []
  if (seen('image') || seen('refs')) caps.push('refImage')
  if (seen('firstFrame')) caps.push('firstFrame')
  if (seen('lastFrame')) caps.push('lastFrame')
  if (seen('assets')) caps.push('assets')
  if (seen('ratio')) caps.push('ratio')
  if (seen('duration')) caps.push('duration')
  if (seen('resolution')) caps.push('resolution')
  if (seen('size')) caps.push('size')
  // 模板里把参数拼进提示词的（--duration 4 这种），占位符也在，所以上面能覆盖到
  return { caps }
}

/** 切到一个还没有项目的模块时，自动建的那个项目叫什么 */
const DEFAULT_PROJECT_NAME: Record<ProjectKind, string> = {
  text: '文本测试',
  image: '图像测试',
  video: '视频测试',
}

export const useStore = create<Store>((set, get) => {
  /** 改当前项目的若干字段 */
  function patchActive(fn: (project: Project) => Partial<Project>) {
    set((state) => ({
      projects: state.projects.map((p) => (p.id === state.activeProjectId ? { ...p, ...fn(p) } : p)),
    }))
  }

  /** 改当前项目的窗口，并刷新“最后使用” */
  function patchActivePanels(fn: (panels: Panel[]) => Panel[]) {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === state.activeProjectId ? { ...p, panels: fn(p.panels), updatedAt: now() } : p,
      ),
    }))
  }

  /**
   * 流式事件按 requestId 路由，要横跨所有项目 ——
   * 切走的项目里还在跑的请求不该丢，回来时结果已经在了。
   */
  function patchPanelsEverywhere(fn: (panels: Panel[]) => Panel[]) {
    set((state) => ({ projects: state.projects.map((p) => ({ ...p, panels: fn(p.panels) })) }))
  }

  const activeProject = () => get().projects.find((p) => p.id === get().activeProjectId) ?? get().projects[0]

  function flushPending() {
    rafHandle = 0
    if (pending.size === 0) return
    const batch = new Map(pending)
    pending.clear()

    patchPanelsEverywhere((panels) =>
      panels.map((panel) => {
        if (!panel.requestId) return panel
        const chunk = batch.get(panel.requestId)
        if (!chunk) return panel
        const idx = panel.messages.findIndex((m) => m.id === panel.streamingMessageId)
        if (idx < 0) return panel
        const messages = panel.messages.slice()
        const msg = { ...messages[idx] }
        if (chunk.content) msg.content += chunk.content
        if (chunk.reasoning) msg.reasoning = (msg.reasoning ?? '') + chunk.reasoning
        messages[idx] = msg
        return { ...panel, messages }
      }),
    )
  }

  function scheduleFlush() {
    if (!rafHandle) rafHandle = requestAnimationFrame(flushPending)
  }

  /** 终态事件：先把缓冲刷干净，再落地状态 */
  function finalize(ev: ChatEvent) {
    flushPending()
    patchPanelsEverywhere((panels) =>
      panels.map((panel) => {
        if (panel.requestId !== ev.requestId) return panel
        const idx = panel.messages.findIndex((m) => m.id === panel.streamingMessageId)
        const messages = panel.messages.slice()
        if (idx >= 0) {
          const msg = { ...messages[idx] }
          msg.elapsedMs = now() - msg.createdAt
          if (ev.type === 'error') msg.error = ev.message ?? '请求失败'
          if (ev.type === 'aborted') msg.aborted = true
          if (ev.type === 'done') msg.usage = ev.usage ?? null
          messages[idx] = msg
        }
        return {
          ...panel,
          messages,
          status: ev.type === 'error' ? 'error' : 'idle',
          error: ev.type === 'error' ? (ev.message ?? '请求失败') : null,
          requestId: null,
          streamingMessageId: null,
        }
      }),
    )
  }

  window.api.onChatEvent((ev) => {
    switch (ev.type) {
      case 'delta':
        if (ev.text) {
          bufferChunk(ev.requestId, 'content', ev.text)
          scheduleFlush()
        }
        break
      case 'reasoning':
        if (ev.text) {
          bufferChunk(ev.requestId, 'reasoning', ev.text)
          scheduleFlush()
        }
        break
      default:
        finalize(ev)
    }
  })

  /** 组装一次请求并发出 */
  function dispatch(panel: Panel, models: ModelConfig[], userText: string): Panel | null {
    const model = models.find((m) => m.id === panel.modelId)
    if (!model) return null

    const userMsg: Message = { id: uid(), role: 'user', content: userText, createdAt: now() }
    const history = [...panel.messages, userMsg]

    const apiMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = []
    if (panel.systemPrompt.trim()) apiMessages.push({ role: 'system', content: panel.systemPrompt })
    for (const m of history) {
      if (m.role === 'system') continue
      if (!m.content.trim()) continue // 跳过失败/空的助手回复，避免污染上下文
      apiMessages.push({ role: m.role, content: m.content })
    }

    const assistantMsg: Message = {
      id: uid(),
      role: 'assistant',
      content: '',
      reasoning: '',
      createdAt: now(),
      modelLabel: model.name,
    }
    const requestId = uid()

    // 只把模型 id 交给主进程；发往哪个地址、带什么参数由主进程按自己的登记表决定
    window.api.send({ requestId, modelId: model.id, messages: apiMessages })

    return {
      ...panel,
      messages: [...history, assistantMsg],
      status: 'streaming',
      requestId,
      streamingMessageId: assistantMsg.id,
      error: null,
    }
  }

  /** 发起一次图像 / 视频生成。和文本不同，这里不流式，靠主进程轮询后一次性回结果 */
  function dispatchGen(
    panel: Panel,
    models: ModelConfig[],
    prompt: string,
    kind: ProjectKind,
    params: NonNullable<Project['genParams']>,
    imagePath: string | null,
  ): Panel | null {
    const model = models.find((m) => m.id === panel.modelId)
    if (!model) return null

    const userMsg: Message = { id: uid(), role: 'user', content: prompt, createdAt: now() }
    const resultMsg: Message = {
      id: uid(),
      role: 'assistant',
      content: '',
      createdAt: now(),
      modelLabel: model.name,
      // 存下提交时的参数 —— 每秒单价要用它来算
      genParams: { ...params },
    }
    const requestId = uid()

    window.api.genSend({
      requestId,
      modelId: model.id,
      prompt,
      imagePath,
      params: kind === 'video' ? params : { size: params.size, ratio: params.ratio },
    })

    return {
      ...panel,
      messages: [...panel.messages, userMsg, resultMsg],
      status: 'streaming',
      requestId,
      streamingMessageId: resultMsg.id,
      error: null,
      progress: '提交中…',
    }
  }

  /** 生成类事件，和文本一样横跨所有项目按 requestId 路由 */
  window.api.onGenEvent((ev: GenEvent) => {
    if (ev.type === 'progress') {
      patchPanelsEverywhere((panels) =>
        panels.map((p) => (p.requestId === ev.requestId ? { ...p, progress: ev.text ?? null } : p)),
      )
      return
    }

    patchPanelsEverywhere((panels) =>
      panels.map((panel) => {
        if (panel.requestId !== ev.requestId) return panel
        const idx = panel.messages.findIndex((m) => m.id === panel.streamingMessageId)
        const messages = panel.messages.slice()
        if (idx >= 0) {
          const msg = { ...messages[idx] }
          msg.elapsedMs = now() - msg.createdAt
          if (ev.type === 'error') msg.error = ev.message ?? '生成失败'
          if (ev.type === 'aborted') msg.aborted = true
          if (ev.type === 'done') {
            msg.media = ev.media
            msg.cost = ev.cost
          }
          messages[idx] = msg
        }
        return {
          ...panel,
          messages,
          status: ev.type === 'error' ? 'error' : 'idle',
          error: ev.type === 'error' ? (ev.message ?? '生成失败') : null,
          requestId: null,
          streamingMessageId: null,
          progress: null,
        }
      }),
    )
  })

  const firstProject = makeProject('默认项目', 'text')



  return {
    ready: false,
    encryptionAvailable: false,
    theme: 'light',
    version: 2,
    activeKind: 'text',
    projects: [firstProject],
    activeProjectId: firstProject.id,
    models: [],
    presets: [],
    modal: null,
    toast: null,

    async hydrate() {
      const { config, keyedModelIds, encryptionAvailable } = await window.api.loadConfig()
      const keyed = new Set(keyedModelIds)

      if (!config) {
        set({ ready: true, encryptionAvailable })
        return
      }

      // 补齐到 9 个窗口，并复位上次退出时残留的 streaming 状态
      const reviveProject = (raw: Partial<Project>, fallbackName: string): Project => {
        const panels = defaultPanels().map((fallback, i) => {
          const saved = raw.panels?.[i]
          if (!saved) return fallback
          return {
            ...fallback,
            ...saved,
            id: fallback.id,
            messages: Array.isArray(saved.messages) ? saved.messages : [],
            status: 'idle' as const,
            requestId: null,
            streamingMessageId: null,
            error: null,
          }
        })
        const layout = raw.layout ?? 4
        const focused = raw.focusedPanelId ?? null
        return {
          id: raw.id ?? uid(),
          name: raw.name ?? fallbackName,
          kind: raw.kind === 'image' || raw.kind === 'video' ? raw.kind : 'text',
          genParams: raw.genParams,
          layout,
          focusedPanelId: focused && panelIndexOf(focused) < layout ? focused : null,
          panels,
          createdAt: raw.createdAt ?? now(),
          updatedAt: raw.updatedAt ?? now(),
        }
      }

      // v1 的存档没有项目概念，把根上的布局和窗口收进一个「默认项目」
      const projects: Project[] = Array.isArray(config.projects)
        ? config.projects.map((p, i) => reviveProject(p, `项目 ${i + 1}`))
        : [reviveProject(config, '默认项目')]

      if (projects.length === 0) projects.push(makeProject('默认项目', 'text'))

      const activeProjectId = projects.some((p) => p.id === config.activeProjectId)
        ? config.activeProjectId
        : projects[0].id

      const models = (config.models ?? []).map((m) => ({ ...m, ...reviveCaps(m), hasKey: keyed.has(m.id) }))
      void window.api.syncModels(toRegistry(models))

      // 模块必须和当前项目对得上，否则打开就看到一个空列表
      const activeKind = projects.find((p) => p.id === activeProjectId)?.kind ?? 'text'

      set({
        ready: true,
        encryptionAvailable,
        theme: config.theme === 'dark' ? 'dark' : 'light',
        activeKind,
        projects,
        activeProjectId,
        models,
        presets: config.presets ?? [],
      })
    },

    setTheme: (theme) => set({ theme }),
    setModal: (modal) => set({ modal }),

    notify(text, tone = 'ok') {
      const id = uid()
      set({ toast: { id, text, tone } })
      setTimeout(() => {
        if (get().toast?.id === id) set({ toast: null })
      }, 2600)
    },

    /* ---------------- 项目 ---------------- */

    setActiveKind(kind) {
      if (get().activeKind === kind) return
      const mine = get().projects.filter((p) => (p.kind ?? 'text') === kind)
      if (mine.length === 0) {
        // 这一类还一个项目都没有 —— 直接建一个，免得切过去是空白
        const project = makeProject(DEFAULT_PROJECT_NAME[kind], kind)
        set((state) => ({ activeKind: kind, projects: [...state.projects, project], activeProjectId: project.id }))
        return
      }
      // 停在这一类里上次用的那个：activeProjectId 已经属于该类就不动
      const keep = mine.some((p) => p.id === get().activeProjectId)
      set({ activeKind: kind, ...(keep ? {} : { activeProjectId: mine[0].id }) })
    },

    createProject(name, kind) {
      const current = activeProject()
      const targetKind = kind ?? current.kind ?? 'text'
      // 同类型才沿用窗口配置；换了类型就从空白开始 —— 文本模型和生成模型不通用
      const inherit = targetKind === (current.kind ?? 'text')
      const project = makeProject(name, targetKind, {
        layout: current.layout,
        panels: inherit ? withoutMessages(current.panels) : defaultPanels(),
        genParams: inherit ? current.genParams : undefined,
      })
      set((state) => ({
        projects: [...state.projects, project],
        activeProjectId: project.id,
        activeKind: targetKind,
      }))
      return project.id
    },

    switchProject(projectId) {
      const target = get().projects.find((p) => p.id === projectId)
      if (!target) return
      // 不打断正在跑的请求：结果会照常写回原项目，切回去就能看到
      set({ activeProjectId: projectId, activeKind: target.kind ?? 'text' })
    },

    renameProject(projectId, name) {
      const trimmed = name.trim()
      if (!trimmed) return
      set((state) => ({
        projects: state.projects.map((p) => (p.id === projectId ? { ...p, name: trimmed } : p)),
      }))
    },

    duplicateProject(projectId) {
      const source = get().projects.find((p) => p.id === projectId)
      if (!source) return
      const copy: Project = {
        ...source,
        id: uid(),
        name: `${source.name} 副本`,
        panels: source.panels.map((p) => ({
          ...p,
          messages: p.messages.slice(),
          status: 'idle',
          requestId: null,
          streamingMessageId: null,
          error: null,
        })),
        createdAt: now(),
        updatedAt: now(),
      }
      set((state) => ({
        projects: [...state.projects, copy],
        activeProjectId: copy.id,
        activeKind: copy.kind ?? 'text',
      }))
      get().notify(`已复制为「${copy.name}」`)
    },

    deleteProject(projectId) {
      const { projects } = get()
      if (projects.length <= 1) {
        get().notify('至少要保留一个项目', 'err')
        return
      }
      const target = projects.find((p) => p.id === projectId)
      // 该项目里还在跑的请求先停掉，免得回调写进已经不存在的窗口
      target?.panels.forEach((p) => p.requestId && window.api.abort(p.requestId))

      const remaining = projects.filter((p) => p.id !== projectId)
      set((state) => {
        if (state.activeProjectId !== projectId) return { projects: remaining }
        // 优先落到同类的下一个，实在没有才跨类跳
        const kind = state.activeKind
        const next = remaining.find((p) => (p.kind ?? 'text') === kind) ?? remaining[0]
        return { projects: remaining, activeProjectId: next.id, activeKind: next.kind ?? 'text' }
      })
    },

    /* ---------------- 布局 / 聚焦 ---------------- */

    setLayout(layout) {
      patchActive((project) => {
        // 聚焦的窗口如果被新布局挤出可视范围，顺手取消聚焦
        const stillVisible = project.focusedPanelId ? panelIndexOf(project.focusedPanelId) < layout : false
        return { layout, focusedPanelId: stillVisible ? project.focusedPanelId : null }
      })
    },

    toggleFocus(panelId) {
      patchActive((project) => {
        if (project.layout === 1) return {} // 单窗口本来就是全屏，没有聚焦的意义
        return { focusedPanelId: project.focusedPanelId === panelId ? null : panelId }
      })
    },

    clearFocus: () => patchActive(() => ({ focusedPanelId: null })),

    /* ---------------- 模型（全局） ---------------- */

    async upsertModel(model, apiKey) {
      // apiKey === null 表示不改动已存的 Key
      if (apiKey !== null) await window.api.setSecret(model.id, apiKey)
      const keyed = new Set(await window.api.listSecrets())

      set((state) => {
        const exists = state.models.some((m) => m.id === model.id)
        const models = exists
          ? state.models.map((m) => (m.id === model.id ? { ...model, hasKey: keyed.has(model.id) } : m))
          : [...state.models, { ...model, hasKey: keyed.has(model.id) }]

        // 新建模型时自动占用当前项目的第一个空窗口，省得再点一次
        let projects = state.projects
        if (!exists) {
          projects = projects.map((project) => {
            if (project.id !== state.activeProjectId) return project
            const emptyIdx = project.panels.findIndex((p) => !p.modelId)
            if (emptyIdx < 0) return project
            return {
              ...project,
              panels: project.panels.map((p, i) =>
                i === emptyIdx ? { ...p, modelId: model.id, systemPrompt: model.systemPrompt } : p,
              ),
            }
          })
        }
        void window.api.syncModels(toRegistry(models))
        return { models, projects }
      })
    },

    async removeModel(modelId) {
      await window.api.clearSecret(modelId)
      // 所有项目里的绑定都要解开，不只是当前这个
      set((state) => {
        const models = state.models.filter((m) => m.id !== modelId)
        void window.api.syncModels(toRegistry(models))
        return {
        models,
        projects: state.projects.map((project) => ({
          ...project,
          panels: project.panels.map((p) => (p.modelId === modelId ? { ...p, modelId: null } : p)),
        })),
        }
      })
    },

    /* ---------------- 窗口 ---------------- */

    setPanelModel(panelId, modelId) {
      const model = get().models.find((m) => m.id === modelId)
      patchActivePanels((panels) =>
        panels.map((p) =>
          p.id === panelId
            ? {
                ...p,
                modelId,
                // 换模型时带出该模型自己存的 system prompt；没存过就保留窗口现有的
                systemPrompt: model?.systemPrompt ? model.systemPrompt : p.systemPrompt,
              }
            : p,
        ),
      )
    },

    togglePanel(panelId) {
      patchActivePanels((panels) => panels.map((p) => (p.id === panelId ? { ...p, enabled: !p.enabled } : p)))
    },

    clearPanel(panelId) {
      patchActivePanels((panels) =>
        panels.map((p) => (p.id === panelId ? { ...p, messages: [], error: null, status: 'idle' } : p)),
      )
    },

    clearAll() {
      get().stopAll()
      patchActivePanels((panels) => panels.map((p) => ({ ...p, messages: [], error: null, status: 'idle' })))
    },

    /* ---------------- system prompt ---------------- */

    setPanelSystemPrompt(panelId, text) {
      patchActivePanels((panels) => panels.map((p) => (p.id === panelId ? { ...p, systemPrompt: text } : p)))
    },

    syncSystemPromptToAll(text) {
      patchActivePanels((panels) => panels.map((p) => ({ ...p, systemPrompt: text })))
      get().notify(`已同步 system prompt 到本项目的全部 ${MAX_PANELS} 个窗口`)
    },

    saveSystemPromptToModel(panelId) {
      const panel = activeProject().panels.find((p) => p.id === panelId)
      if (!panel?.modelId) {
        get().notify('该窗口还没有选模型', 'err')
        return
      }
      const model = get().models.find((m) => m.id === panel.modelId)
      if (!model) return
      set((state) => ({
        models: state.models.map((m) => (m.id === model.id ? { ...m, systemPrompt: panel.systemPrompt } : m)),
      }))
      get().notify(`已存为「${model.name}」的默认 system prompt`)
    },

    applyPresetToPanel(panelId, presetId) {
      const preset = get().presets.find((p) => p.id === presetId)
      if (preset) get().setPanelSystemPrompt(panelId, preset.content)
    },

    applyPresetToAll(presetId) {
      const preset = get().presets.find((p) => p.id === presetId)
      if (preset) get().syncSystemPromptToAll(preset.content)
    },

    /* ---------------- 提示词库（全局） ---------------- */

    upsertPreset(preset) {
      set((state) => {
        const exists = state.presets.some((p) => p.id === preset.id)
        return {
          presets: exists ? state.presets.map((p) => (p.id === preset.id ? preset : p)) : [...state.presets, preset],
        }
      })
    },

    removePreset(presetId) {
      set((state) => ({ presets: state.presets.filter((p) => p.id !== presetId) }))
    },

    /* ---------------- 会话 ---------------- */

    send(text, opts) {
      const trimmed = text.trim()
      if (!trimmed) return 0

      const project = activeProject()
      const kind = project.kind ?? 'text'
      const models = get().models
      const visible = new Set(project.panels.slice(0, project.layout).map((p) => p.id))
      let count = 0

      patchActivePanels((panels) =>
        panels.map((panel) => {
          const isTarget = opts?.onlyPanelId
            ? panel.id === opts.onlyPanelId
            : visible.has(panel.id) && panel.enabled
          if (!isTarget || !panel.modelId || panel.status === 'streaming') return panel
          const next =
            kind === 'text'
              ? dispatch(panel, models, trimmed)
              : dispatchGen(panel, models, trimmed, kind, project.genParams ?? {}, opts?.imagePath ?? null)
          if (!next) return panel
          count += 1
          return next
        }),
      )

      return count
    },

    setGenMode(id) {
      // 换模式时清掉上一个模式特有的素材 —— 留着看不见却会发出去更糟
      patchActive(() => ({ genMode: id }))
    },

    setGenParams(patch) {
      patchActive((project) => ({ genParams: { ...project.genParams, ...patch } }))
    },

    retryPanel(panelId) {
      const project = activeProject()
      // 生成类重试 = 重新花钱，不给隐式入口，让用户自己重新点发送
      if ((project.kind ?? 'text') !== 'text') return
      const panel = project.panels.find((p) => p.id === panelId)
      if (!panel || panel.status === 'streaming') return

      // 回退到最后一条用户消息，重新发一次
      const lastUserIdx = [...panel.messages].reverse().findIndex((m) => m.role === 'user')
      if (lastUserIdx < 0) return
      const idx = panel.messages.length - 1 - lastUserIdx
      const userText = panel.messages[idx].content
      const trimmedPanel: Panel = { ...panel, messages: panel.messages.slice(0, idx) }
      const models = get().models

      patchActivePanels((panels) =>
        panels.map((p) => (p.id === panelId ? (dispatch(trimmedPanel, models, userText) ?? p) : p)),
      )
    },

    stopPanel(panelId) {
      const panel = activeProject().panels.find((p) => p.id === panelId)
      if (!panel?.requestId) return
      // 两条通道都发一次；主进程按 requestId 找 AbortController，发错那条是空操作
      window.api.abort(panel.requestId)
      window.api.genAbort(panel.requestId)
    },

    stopAll() {
      for (const panel of activeProject().panels) {
        if (!panel.requestId) continue
        window.api.abort(panel.requestId)
        window.api.genAbort(panel.requestId)
      }
    },
  }
})

/* -------------------------------------------------------------- *
 * 当前项目的派生读取器。返回的都是 state 里已有的引用或原始值，
 * 不会每次生成新对象，所以不会引起额外重渲染。
 * -------------------------------------------------------------- */
const pickActive = (state: Store): Project =>
  state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0]

export const useActiveProject = () => useStore(pickActive)
export const usePanels = () => useStore((s) => pickActive(s).panels)
export const useLayout = () => useStore((s) => pickActive(s).layout)
export const useFocusedPanelId = () => useStore((s) => pickActive(s).focusedPanelId)

/* -------------------------------------------------------------- *
 * 持久化：状态变更后防抖写盘
 * -------------------------------------------------------------- */
const MAX_SAVED_MESSAGES = 80
let saveTimer: ReturnType<typeof setTimeout> | null = null

export function startPersistence() {
  useStore.subscribe((state) => {
    if (!state.ready) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const snapshot: PersistedState = {
        version: 2,
        theme: state.theme,
        activeKind: state.activeKind,
        activeProjectId: state.activeProjectId,
        models: state.models.map(({ hasKey: _hasKey, ...rest }) => rest),
        presets: state.presets,
        projects: state.projects.map((project) => ({
          ...project,
          panels: project.panels.map((p) => ({
            ...p,
            messages: p.messages.slice(-MAX_SAVED_MESSAGES),
            status: 'idle' as const,
            requestId: null,
            streamingMessageId: null,
            error: null,
          })),
        })),
      }
      void window.api.saveConfig(snapshot)
    }, 600)
  })
}

// 仅开发期：自动化脚本没法驱动系统文件选择框，留一个入口来注入。
// import.meta.env.DEV 是编译期常量，生产构建里整段会被摇掉。
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__store = useStore
}
