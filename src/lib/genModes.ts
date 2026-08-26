import type { ModelCap, ProjectKind } from '../types'

/** 输入区的一个素材卡片槽位 */
export interface SlotSpec {
  /** 存到 genParams 的哪个字段 */
  field: 'firstFrame' | 'lastFrame' | 'refs' | 'assets'
  label: string
  /** assets 槽位限定的素材类型；不填 = 三类都能加 */
  assetKind?: 'image' | 'video' | 'audio'
  /** 可以放多个 */
  multi?: boolean
  /** 和前一个槽位之间画一个互换按钮（首帧 ⇌ 尾帧） */
  swapWithPrev?: boolean
  /** 可不填：空着就按纯文生跑 */
  optional?: boolean
}

/**
 * 生成模式：决定输入区长什么样，也决定哪些模型能用。
 * 一个模型只有具备 requires 里的全部能力，才算支持这个模式。
 */
export interface GenMode {
  id: string
  label: string
  kind: ProjectKind
  hint: string
  requires: ModelCap[]
  slots: SlotSpec[]
  /** 菜单里的图标名，见 components/Icons 的 MODE_ICONS */
  icon: string
  /** 打上 Beta 角标 */
  beta?: boolean
}

export const GEN_MODES: GenMode[] = [
  {
    // 视频默认就是全能参考：不传素材 = 文生视频，传了就按 @Image1 等引用。
    // requires 留空 —— 是否吃得下素材按「实际传了什么」在发送时查
    id: 'video-ref',
    icon: 'ref',
    label: '全能参考',
    kind: 'video',
    hint: '图、视频、音频都能当参考，在提示词里用 @Image1 引用；不传就是文生视频',
    requires: [],
    slots: [{ field: 'assets', label: '参考内容', multi: true, optional: true }],
  },
  {
    id: 'video-frames',
    icon: 'frames',
    label: '首尾帧',
    kind: 'video',
    hint: '指定开始和结束画面，中间由模型补全',
    requires: ['firstFrame', 'lastFrame'],
    slots: [
      { field: 'firstFrame', label: '首帧' },
      { field: 'lastFrame', label: '尾帧', swapWithPrev: true },
    ],
  },
  {
    // 图像只有这一种，界面上没有模式选择器
    id: 'image-std',
    icon: 'image',
    label: '参考出图',
    kind: 'image',
    hint: '不传参考就是文生图，传了就按参考出图',
    requires: [],
    slots: [{ field: 'assets', label: '参考内容', multi: true, optional: true }],
  },
]

export const modesFor = (kind: ProjectKind) => GEN_MODES.filter((m) => m.kind === kind)

export const modeById = (id?: string) => GEN_MODES.find((m) => m.id === id)

/** 默认落到该类型的第一个模式 */
export const defaultModeFor = (kind: ProjectKind) => modesFor(kind)[0]?.id ?? ''

/**
 * 模式要求的素材齐了没有。
 * 首尾帧模式两张都得给；参考类至少给一个 —— 少给一张就发出去，
 * 上游多半照跑不误，钱花了结果却不是你要的。
 */
export function missingSlots(mode: GenMode | undefined, params: {
  firstFrame?: string
  lastFrame?: string
  refs?: string[]
  assets?: { kind: string }[]
}): string[] {
  if (!mode) return []
  const missing: string[] = []
  const required = mode.slots.filter((s) => !s.optional)
  const wantsRef = required.some((s) => s.field === 'refs' || s.field === 'assets')
  for (const slot of required) {
    if (slot.field === 'firstFrame' && !params.firstFrame) missing.push(slot.label)
    if (slot.field === 'lastFrame' && !params.lastFrame) missing.push(slot.label)
  }
  if (wantsRef && !(params.refs?.length || params.assets?.length)) missing.push('参考内容')
  return missing
}

/** 这个模型撑不撑得起这个模式 */
export function modeSupported(caps: ModelCap[] | undefined, mode: GenMode | undefined): boolean {
  if (!mode) return true
  const has = new Set(caps ?? [])
  return mode.requires.every((c) => has.has(c))
}
