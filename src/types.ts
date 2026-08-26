export type Role = 'system' | 'user' | 'assistant'

/** 项目类型：一个项目里所有窗口同类型 */
export type ProjectKind = 'text' | 'image' | 'video'

export const PROJECT_KINDS: { kind: ProjectKind; label: string; hint: string }[] = [
  { kind: 'text', label: '文本', hint: '一个提示词同时问多个模型' },
  { kind: 'image', label: '图像', hint: '同一提示词横向对比出图' },
  { kind: 'video', label: '视频', hint: '同一提示词横向对比生成视频' },
]

/**
 * 模型支持的能力。输入区只显示当前窗口模型真正支持的控件 ——
 * 摆一个模型不支持的字段，用户填了不生效，比不给更糟。
 */
export type ModelCap =
  | 'refImage'   // 全能参考：一张或多张参考图
  | 'firstFrame' // 首帧
  | 'lastFrame'  // 尾帧
  | 'assets'     // @素材：在提示词里引用已上传的素材
  | 'ratio'      // 画面比例
  | 'duration'   // 时长
  | 'resolution' // 清晰度
  | 'size'       // 像素尺寸

export const MODEL_CAPS: { cap: ModelCap; label: string; hint: string; kinds: ProjectKind[] }[] = [
  { cap: 'refImage', label: '全能参考', hint: '一张或多张参考图，占位符 {{refs}}（首张也可用 {{image}}）', kinds: ['image', 'video'] },
  { cap: 'firstFrame', label: '首帧', hint: '指定视频第一帧，占位符 {{firstFrame}}', kinds: ['video'] },
  { cap: 'lastFrame', label: '尾帧', hint: '指定视频最后一帧，占位符 {{lastFrame}}', kinds: ['video'] },
  { cap: 'assets', label: '@素材', hint: '在提示词里用 @名字 引用素材，占位符 {{assets}}', kinds: ['image', 'video'] },
  { cap: 'ratio', label: '比例', hint: '如 16:9，占位符 {{ratio}}', kinds: ['image', 'video'] },
  { cap: 'duration', label: '时长', hint: '秒，占位符 {{duration}}', kinds: ['video'] },
  { cap: 'resolution', label: '清晰度', hint: '如 480p / 720p / 1080p，占位符 {{resolution}}', kinds: ['video'] },
  { cap: 'size', label: '尺寸', hint: '如 1024x1024，占位符 {{size}}', kinds: ['image'] },
]

/**
 * 每个模型自己的参数取值范围。各家差别很大，写死一套会让用户
 * 填出接口不认的值——每次都是真金白银，所以按模型分开配。
 * 数组留空 = 不限制，自由输入。
 */
export interface CapOptions {
  ratio?: string[]
  resolution?: string[]
  size?: string[]
  /** 时长：给了 values 就按枚举，否则按 [min, max] 的整数区间 */
  durationValues?: number[]
  durationMin?: number
  durationMax?: number
  /**
   * 单窗口布局下的时长上限。长视频又慢又贵，横向对比时也该让各模型
   * 在同一时长上比才公平，所以只有布局为 1 个窗口时才放开到这个值。
   * 不填 = 和 durationMax 一样，不区分。
   */
  durationMaxSolo?: number
  /** 参考图最多几张 */
  refMax?: number
  /** @素材分类型的上限。缺省 = 不限 */
  assetMaxImage?: number
  assetMaxVideo?: number
  assetMaxAudio?: number
}

/** 推理强度：o 系列 / Claude thinking / DeepSeek-R1 这类模型的 reasoning_effort */
export type ReasoningEffort = 'low' | 'medium' | 'high'
export const REASONING_EFFORTS: { value: ReasoningEffort; label: string }[] = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

export type LayoutCount = 1 | 2 | 3 | 4 | 6 | 9

export const LAYOUTS: LayoutCount[] = [1, 2, 3, 4, 6, 9]

/** 每种布局的网格排布 */
export const LAYOUT_GRID: Record<LayoutCount, { cols: number; rows: number }> = {
  1: { cols: 1, rows: 1 },
  2: { cols: 2, rows: 1 },
  3: { cols: 3, rows: 1 },
  4: { cols: 2, rows: 2 },
  6: { cols: 3, rows: 2 },
  9: { cols: 3, rows: 3 },
}

export const MAX_PANELS = 9

export interface Message {
  id: string
  role: Role
  content: string
  /** 思维链（DeepSeek-R1 / QwQ 等的 reasoning_content） */
  reasoning?: string
  error?: string | null
  aborted?: boolean
  createdAt: number
  /** 生成用时（毫秒） */
  elapsedMs?: number
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null
  /** 该条回复由哪个模型生成，便于事后回看 */
  modelLabel?: string

  /** 图像/视频结果 */
  media?: {
    kind: 'image' | 'video'
    /** API 返回的原始 URL，通常有时效 */
    url: string
    /** 已下载到本地的绝对路径 —— 链接过期后靠它显示 */
    localPath?: string
  }
  /** 这次生成的花费 */
  cost?: {
    /** 金额，单位元。取不到为 null */
    amount: number | null
    /** 每秒单价，仅视频。amount / durationSec */
    perSecond: number | null
    /** 消耗量（credits 之类） */
    credits: number | null
    /** 金额是直接读到的还是用消耗量换算的 */
    source: 'amount' | 'credits' | null
  }
  /** 提交时用的生成参数，用来算每秒单价 */
  genParams?: GenParams
}

/** 参考素材的类型 */
export type AssetKind = 'image' | 'video' | 'audio'

export const ASSET_KINDS: { kind: AssetKind; label: string; exts: string[]; accept: string }[] = [
  { kind: 'image', label: '图片', exts: ['png', 'jpg', 'jpeg', 'webp', 'gif'], accept: 'image' },
  { kind: 'video', label: '视频', exts: ['mp4', 'mov', 'webm'], accept: 'video' },
  { kind: 'audio', label: '音频', exts: ['mp3', 'wav', 'm4a', 'aac'], accept: 'audio' },
]

/**
 * 一个参考素材。
 * 本地文件走 base64 内联（图片实测可用）；视频/音频体积大，多数接口只收公网地址，
 * 所以两种来源都留着，由 url 是否存在决定走哪条路。
 */
export interface Asset {
  kind: AssetKind
  /** 本地绝对路径。和 url 二选一 */
  path?: string
  /** 公网地址。和 path 二选一 */
  url?: string
  /** 在提示词里怎么引用它，如 Image1 / Video1 / Audio1 */
  label: string
}

/** 一次生成用到的参数。字段是否出现在界面上，由绑定模型的 caps 决定 */
export interface GenParams {
  duration?: number
  size?: string
  ratio?: string
  resolution?: string
  seed?: number
  /** 参考图的本地绝对路径 */
  refs?: string[]
  firstFrame?: string
  lastFrame?: string
  /** @素材：图片 / 视频 / 音频参考，在提示词里用 @Image1 @Video1 @Audio1 引用 */
  assets?: Asset[]
}

/**
 * 图像/视频生成模型的通用适配配置。
 * 这两类没有统一协议，所以把「请求体模板 + 取值 JSON 路径」全开放出来配。
 * pollURL 留空 = 同步接口，提交即出结果。
 */
export interface GenConfig {
  /* ---- 提交 ---- */
  submitURL: string
  /** 请求体 JSON 模板，占位符：{{prompt}} {{model}} {{duration}} {{size}} {{ratio}} {{image}} {{seed}} */
  submitBody: string

  /* ---- 轮询 ---- */
  /** 轮询地址，用 {{id}} 占位。留空表示同步返回，不轮询 */
  pollURL: string
  pollIntervalMs: number
  timeoutMs: number

  /* ---- 取值路径（点号 + [n]，如 data.output[0].url）---- */
  /** 从提交响应里取任务 id */
  idPath: string
  statusPath: string
  /** 逗号分隔，命中即算成功 / 失败 */
  successValues: string
  failValues: string
  /** 结果文件 URL */
  resultPath: string
  /** 失败原因（可选） */
  errorPath: string

  /* ---- 价格 ---- */
  /** 直接的金额字段，如 usage.amount（单位元） */
  pricePath: string
  /** 消耗量字段，如 extra_data.credits。值是 JSON 字符串时会自动二次解析 */
  creditsPath: string
  /** 实际时长字段，用来算每秒单价。留空则用提交时填的时长 */
  durationPath: string
  /** 每个 credit 多少元 —— pricePath 取不到或为 0 时用它换算 */
  unitPrice: number | null
}

export interface ModelConfig {
  id: string
  /** 窗口标题上显示的名字 */
  name: string
  baseURL: string
  /** 请求里发给上游的模型 ID */
  model: string
  temperature: number | null
  maxTokens: number | null
  /** 这个模型自己记住的 system prompt —— 选中该模型时自动带入窗口 */
  systemPrompt: string
  /** 由主进程回填：是否已存过 API Key（明文永远不进渲染进程） */
  hasKey?: boolean

  /** 这个模型属于哪种项目类型。缺省视为 text（v2 存档升级用） */
  kind?: ProjectKind
  /** kind 为 image / video 时的适配配置 */
  gen?: GenConfig
  /** 这个模型支持哪些能力 —— 输入区据此决定显示哪些控件 */
  caps?: ModelCap[]
  /** 各能力的取值范围。缺省 = 不限制 */
  capOptions?: CapOptions
  /** 文本模型的推理强度，发请求时作为 reasoning_effort 传出。null = 不传 */
  reasoningEffort?: ReasoningEffort | null
}

export interface PromptPreset {
  id: string
  name: string
  content: string
  updatedAt: number
}

export type PanelStatus = 'idle' | 'streaming' | 'error'

export interface Panel {
  id: string
  modelId: string | null
  /** 该窗口当前生效的 system prompt */
  systemPrompt: string
  messages: Message[]
  status: PanelStatus
  /** 是否参与「发送到全部」 */
  enabled: boolean
  requestId: string | null
  streamingMessageId: string | null
  error: string | null
  /** 生成类任务的进度文案，如「排队中 · 12s」 */
  progress?: string | null
}

export type ModalState =
  | null
  | { type: 'model'; modelId: string | null }
  | { type: 'systemPrompt'; panelId: string }
  | { type: 'library' }
  | { type: 'settings' }

/**
 * 一个项目 = 一套完整的测试工作区：布局、9 个窗口的模型绑定与 system prompt、以及对话记录。
 * 模型配置和提示词库是全局的，不进项目 —— 同一个 DeepSeek 不该每个项目重配一遍。
 */
export interface Project {
  id: string
  name: string
  /** 缺省视为 text（老存档升级用） */
  kind?: ProjectKind
  layout: LayoutCount
  /** 聚焦模式：该窗口占主区，其余收进右侧列 */
  focusedPanelId: string | null
  panels: Panel[]
  /** 图像/视频项目的生成参数，跟着项目走 */
  genParams?: GenParams
  /** 当前的生成模式（文生视频 / 首尾帧 / 全能参考…），见 lib/genModes */
  genMode?: string
  createdAt: number
  updatedAt: number
}

export interface PersistedState {
  version: number
  theme: 'dark' | 'light'
  /** 侧栏顶部选中的测试内容模块 —— 项目列表按它筛选 */
  activeKind?: ProjectKind
  projects: Project[]
  activeProjectId: string
  models: ModelConfig[]
  presets: PromptPreset[]
}

/** v1 的存档格式：布局和窗口直接挂在根上，没有项目概念 */
export interface PersistedStateV1 {
  version?: number
  theme?: 'dark' | 'light'
  layout?: LayoutCount
  focusedPanelId?: string | null
  panels?: Panel[]
  models?: ModelConfig[]
  presets?: PromptPreset[]
}

/* ---- preload 暴露的接口 ---- */

export interface ChatEvent {
  requestId: string
  type: 'delta' | 'reasoning' | 'done' | 'error' | 'aborted'
  text?: string
  message?: string
  usage?: Message['usage']
}

/** 生成类任务的事件流 */
export interface GenEvent {
  requestId: string
  type: 'progress' | 'done' | 'error' | 'aborted'
  /** progress: 进度文案 */
  text?: string
  message?: string
  media?: Message['media']
  cost?: Message['cost']
}

/** 发起一次生成 */
export interface GenPayload {
  requestId: string
  modelId: string
  prompt: string
  /** 图生视频 / 参考图：本地绝对路径，主进程负责编码或上传 */
  imagePath?: string | null
  params?: GenParams
}

export interface TestResult {
  ok: boolean
  message?: string
  models?: string[]
}

export interface DataInfo {
  dir: string
  config: string
  secrets: string
  isDefault: boolean
  defaultDir: string
}

export interface DataMoveResult extends Partial<DataInfo> {
  ok: boolean
  canceled?: boolean
  moved?: boolean
  /** 目标目录本来就有 TestHub 数据，直接接管而不是覆盖 */
  adopted?: boolean
  message?: string
}

declare global {
  interface Window {
    api: {
      platform: string
      loadConfig: () => Promise<{
        config: (PersistedState & PersistedStateV1) | null
        keyedModelIds: string[]
        encryptionAvailable: boolean
      }>
      saveConfig: (state: PersistedState) => Promise<boolean>
      setSecret: (modelId: string, apiKey: string) => Promise<string[]>
      clearSecret: (modelId: string) => Promise<string[]>
      listSecrets: () => Promise<string[]>
      testModel: (payload: {
        modelId: string
        baseURL: string
        model: string
        apiKey?: string
      }) => Promise<TestResult>
      listModels: (payload: { modelId: string; baseURL: string; apiKey?: string }) => Promise<TestResult>
      syncModels: (models: Omit<ModelConfig, 'hasKey'>[]) => Promise<number>
      /** 只传模型 id 和消息 —— 目标地址与参数由主进程从自己的登记表解析 */
      send: (payload: {
        requestId: string
        modelId: string
        messages: { role: Role; content: string }[]
      }) => void
      abort: (requestId: string) => void
      onChatEvent: (cb: (ev: ChatEvent) => void) => () => void

      /** 图像 / 视频生成：提交 → 轮询 → 下载，全在主进程 */
      genSend: (payload: GenPayload) => void
      genAbort: (requestId: string) => void
      onGenEvent: (cb: (ev: GenEvent) => void) => () => void
      /** 选一个本地素材。视频/音频过大时 tooBig=true，需要改用公网地址 */
      pickImage: (kind?: AssetKind | 'any') => Promise<{
        path: string
        name: string
        kind: AssetKind
        dataUrl: string
        size?: number
        tooBig?: boolean
        error?: string
      } | null>
      /** 在系统里打开已下载的媒体文件 */
      openPath: (p: string) => Promise<void>
      revealPath: (p: string) => Promise<void>
      openExternal: (url: string) => Promise<void>
      paths: () => Promise<DataInfo>
      dataInfo: () => Promise<DataInfo>
      dataReveal: () => Promise<void>
      dataChoose: () => Promise<DataMoveResult>
      dataReset: () => Promise<DataMoveResult>
    }
  }
}
