import type { CapOptions, ModelCap, ProjectKind } from '../types'

/**
 * 各家模型的参数档案。
 *
 * 来源分两种，都标注在 note 里：
 *   实测 —— 用真实接口探过边界（越界值被拒 = 区间成立）
 *   文档 —— 取自服务商文档，没有逐个花钱验证
 *
 * 一个重要发现：Seedance 只认提示词里的 --flags，完全无视顶层同名字段；
 * Kling 恰好相反，只认顶层字段。所以请求体模板里两种形式都要带。
 */
export interface ParamProfile {
  id: string
  label: string
  kind: ProjectKind
  /** 匹配模型 ID 的关键字，用来给已存模型自动套档案 */
  match: RegExp
  caps: ModelCap[]
  options: CapOptions
  note: string
}

export const PARAM_PROFILES: ParamProfile[] = [
  {
    // 快速版单列：实测它拒绝 1080p 和 4k，只有 480p / 720p
    id: 'seedance-fast',
    label: 'Seedance 快速版（2.0-fast）',
    kind: 'video',
    match: /^(?!.*2[-_. ]?5).*seedance.*fast|^(?!.*2[-_. ]?5).*fast.*seedance/i,
    caps: ['duration', 'ratio', 'resolution', 'refImage', 'firstFrame', 'lastFrame'],
    options: {
      durationMin: 4,
      durationMax: 15,
      resolution: ['480p', '720p'],
      resolutionDefault: '480p',
      ratio: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9', '9:21', '2:1', '1:2', '16:10', '10:16', '5:4', '4:5', '235:100', 'adaptive'],
      refMax: 9,
    },
    note: '实测：1080p 和 4k 被拒，只有 480p/720p。另外实测填 720p 时出片仍是 864x496（约 480p），快速版可能内部封顶，别按 720p 预期画质。',
  },
  {
    // 2.5 是另一个量级：时长翻倍到 30 秒，参考素材上限 50 个
    id: 'seedance-25',
    label: 'Seedance 2.5',
    kind: 'video',
    match: /seedance[-_. ]?2[-_. ]?5/i,
    caps: ['duration', 'ratio', 'resolution', 'refImage', 'firstFrame', 'lastFrame', 'assets'],
    options: {
      // 实测：31 / 41 / 61 / 120 全被拒，2 和 3 也被拒 → 接口上限 30、下限 4。
      // 但 30 秒只在单窗口布局下放开：多窗口是横向对比，统一到 15 秒才好比，
      // 也免得一次点下去跑出四个 30 秒的长视频。
      durationMin: 4,
      durationMax: 15,
      durationMaxSolo: 30,
      // 实测：1080p 和 4k 都被接受
      resolution: ['480p', '720p', '1080p', '4k'],
      resolutionDefault: '480p',
      ratio: [
        '16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9', '9:21',
        '2:1', '1:2', '16:10', '10:16', '5:4', '4:5', '235:100', 'adaptive',
      ],
      // 文档：最多 50 个参考素材 = 30 图 + 10 视频 + 10 音频
      refMax: 30,
      assetMaxImage: 30,
      assetMaxVideo: 10,
      assetMaxAudio: 10,
    },
    note: '时长最长 30 秒（实测 31 被拒），但只在单窗口布局下放开；多窗口对比时统一压到 15 秒。原生 1080p，支持 4k。参考素材最多 50 个（30 图 + 10 视频 + 10 音频），提示词里用 @Image1 / @Video1 / @Audio1 引用。',
  },
  {
    id: 'seedance',
    label: 'Seedance 2.0 标准版',
    kind: 'video',
    match: /seedance/i,
    caps: ['duration', 'ratio', 'resolution', 'refImage', 'firstFrame', 'lastFrame'],
    options: {
      // 实测：3 / 16 / 20 全部被拒，[4,15] 成立
      durationMin: 4,
      durationMax: 15,
      // 实测：2.5 接受 1080p 和 4k；更低或更高的值被拒
      resolution: ['480p', '720p', '1080p', '4k'],
      resolutionDefault: '480p',
      // 实测：5:7 和 32:9 都被接受 —— 比例其实不校验，这里只是常用值
      ratio: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9', '9:21', '2:1', '1:2', '16:10', '10:16', '5:4', '4:5', '235:100', 'adaptive'],
      refMax: 9,
    },
    note: '时长 4–15 秒（实测 16 和 31 都被拒）。清晰度四档，其他值会被拒。比例接口不校验，列的是常用值。',
  },
  {
    id: 'kling',
    label: 'Kling 可灵',
    kind: 'video',
    match: /kling/i,
    caps: ['duration', 'ratio'],
    options: {
      // 实测：3 / 6 / 11 都被接受，20 被拒 —— 不是网上说的「只能 5 或 10」
      durationMin: 1,
      durationMax: 15,
      ratio: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    },
    note: '实测 3/6/11 秒都能过，20 秒被拒。它只认顶层字段，不解析提示词里的 --flags。',
  },
  {
    id: 'seedream',
    label: 'Seedream 系列（豆包图像）',
    kind: 'image',
    match: /seedream/i,
    caps: ['size', 'refImage'],
    options: {
      size: ['1K', '2K', '4K', '1024x1024', '2048x2048', '1280x720', '720x1280', '1536x1024'],
      refMax: 10,
    },
    note: '文档：size 支持 1K/2K/4K 关键字或 宽x高。',
  },
  {
    id: 'gpt-image',
    label: 'GPT Image',
    kind: 'image',
    match: /gpt-image|dall/i,
    caps: ['size'],
    options: { size: ['1024x1024', '1536x1024', '1024x1536', 'auto'] },
    note: '文档：OpenAI 图像接口的固定三档 + auto。',
  },
  {
    id: 'gemini-image',
    label: 'Gemini Image',
    kind: 'image',
    match: /gemini.*image/i,
    caps: ['size', 'refImage'],
    options: { size: ['1024x1024', '1408x768', '768x1408'], refMax: 3 },
    note: '文档值，未逐个实测。',
  },
]

export const profileFor = (modelId: string, kind: ProjectKind): ParamProfile | undefined =>
  PARAM_PROFILES.find((p) => p.kind === kind && p.match.test(modelId))
