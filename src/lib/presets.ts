export interface ProviderPreset {
  label: string
  baseURL: string
  /** 常见模型 ID，仅作填充建议 */
  models: string[]
  docs?: string
}

/** 全部走 OpenAI 兼容协议，用户只需要换 Base URL + Key + 模型 ID */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o3-mini'],
    docs: 'https://platform.openai.com/api-keys',
  },
  {
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    docs: 'https://platform.deepseek.com/api_keys',
  },
  {
    label: '通义千问 / DashScope',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwq-plus'],
    docs: 'https://bailian.console.aliyun.com/',
  },
  {
    label: 'Kimi / Moonshot',
    baseURL: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-latest'],
    docs: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    label: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'],
    docs: 'https://bigmodel.cn/usercenter/apikeys',
  },
  {
    label: '火山方舟 / 豆包',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['填入你的推理接入点 ID (ep-xxxx)'],
    docs: 'https://console.volcengine.com/ark',
  },
  {
    label: '硅基流动 SiliconFlow',
    baseURL: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
    docs: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-sonnet-4', 'google/gemini-2.5-pro', 'openai/gpt-4o'],
    docs: 'https://openrouter.ai/keys',
  },
  {
    label: 'Ollama（本地）',
    baseURL: 'http://localhost:11434/v1',
    models: ['llama3.2', 'qwen2.5'],
    docs: 'https://ollama.com/',
  },
  {
    label: '自定义',
    baseURL: '',
    models: [],
  },
]

/* ------------------------------------------------------------------ *
 * 图像 / 视频生成的适配预设
 *
 * 这两类没有统一协议，所以预设只是帮你少打字 —— 填完还要按自己接的
 * 服务商核对一遍路径。占位符：
 *   {{prompt}} {{model}} {{duration}} {{size}} {{ratio}} {{seed}} {{image}}
 * ------------------------------------------------------------------ */

import type { GenConfig, ModelCap, ProjectKind } from '../types'

export interface GenPreset {
  label: string
  kind: ProjectKind
  /** 需要用户自己补的部分，展示在提示里 */
  note?: string
  model: string
  /** 这套配置对应的模型支持哪些能力 —— 决定输入区显示哪些控件 */
  caps: ModelCap[]
  gen: GenConfig
}

export const GEN_PRESETS: GenPreset[] = [
  {
    label: '视频通用（Seedance / Kling）',
    kind: 'video',
    caps: ['duration', 'ratio', 'resolution', 'refImage', 'firstFrame', 'lastFrame', 'assets'],
    note: '实测通吃 Seedance 全系和 klingai/kling-v3，只改模型 ID。参数同时以 --flags 和顶层字段两种形式发：Seedance 只认前者、Kling 只认后者，各取所需（Kling 的提示词里会多出 flags 字样，实测不影响出片）',
    model: 'bytedance/seedance-2-0-fast',
    gen: {
      submitURL: 'https://your-gateway.example.com/v1/videos/async_generations',
      submitBody: `{
  "model": "{{model}}",
  "content": [
    { "type": "text", "text": "{{prompt}} --resolution {{resolution}} --duration {{duration}} --ratio {{ratio}}" },
    {{imageItems}}
  ],
  "duration": {{duration}},
  "ratio": "{{ratio}}"
}`,
      pollURL: 'https://your-gateway.example.com/v1/videos/async_generations/{{id}}',
      pollIntervalMs: 5000,
      timeoutMs: 600000,
      idPath: 'data.id',
      statusPath: 'data.status',
      successValues: 'succeeded,succeed,success,completed',
      failValues: 'failed,error,cancelled',
      resultPath: 'data.url',
      errorPath: 'error.message',
      pricePath: 'usage.amount',
      creditsPath: '',
      durationPath: 'data.extra_data.duration',
      unitPrice: null,
    },
  },
  {
    label: '视频通用 · 图生视频',
    kind: 'video',
    caps: ['duration', 'ratio', 'resolution', 'refImage', 'firstFrame', 'lastFrame', 'assets'],
    note: '实测可用。需要在输入区选一张参考图，没选会在发送前被拦下',
    model: 'bytedance/seedance-2-0-fast',
    gen: {
      submitURL: 'https://your-gateway.example.com/v1/videos/async_generations',
      submitBody: `{
  "model": "{{model}}",
  "content": [
    { "type": "text", "text": "{{prompt}} --resolution {{resolution}} --duration {{duration}} --ratio {{ratio}}" },
    {{imageItems}}
  ],
  "duration": {{duration}},
  "ratio": "{{ratio}}"
}`,
      pollURL: 'https://your-gateway.example.com/v1/videos/async_generations/{{id}}',
      pollIntervalMs: 5000,
      timeoutMs: 600000,
      idPath: 'data.id',
      statusPath: 'data.status',
      successValues: 'succeeded,succeed,success,completed',
      failValues: 'failed,error,cancelled',
      resultPath: 'data.url',
      errorPath: 'error.message',
      pricePath: 'usage.amount',
      creditsPath: '',
      durationPath: 'data.extra_data.duration',
      unitPrice: null,
    },
  },
  {
    label: '图像生成（Seedream 系）',
    kind: 'image',
    caps: ['size', 'refImage'],
    note: '实测可用（Seedream 4.0/4.5/5.0-lite、gpt-image-2、gemini-3-pro-image 同一套配置，改模型 ID 即可）。同步接口，轮询地址留空。注意 qwen-image 系列走不通 —— 网关不支持它要的 input.messages 格式',
    model: 'bytedance/doubao-seedream-4-0',
    gen: {
      submitURL: 'https://your-gateway.example.com/v1/images/generations',
      submitBody: `{
  "model": "{{model}}",
  "prompt": "{{prompt}}",
  "size": "{{size}}",
  "image": {{imageUrls}}
}`,
      pollURL: '',
      pollIntervalMs: 3000,
      timeoutMs: 180000,
      idPath: '',
      statusPath: '',
      successValues: '',
      failValues: '',
      resultPath: 'data[0].url',
      errorPath: 'error.message',
      pricePath: 'usage.amount',
      creditsPath: '',
      durationPath: '',
      unitPrice: null,
    },
  },
  {
    label: 'OpenAI 图像（同步返回）',
    kind: 'image',
    caps: ['size'],
    model: 'gpt-image-1',
    gen: {
      submitURL: 'https://api.openai.com/v1/images/generations',
      submitBody: `{
  "model": "{{model}}",
  "prompt": "{{prompt}}",
  "size": "{{size}}",
  "n": 1
}`,
      pollURL: '',
      pollIntervalMs: 3000,
      timeoutMs: 180000,
      idPath: '',
      statusPath: '',
      successValues: '',
      failValues: '',
      resultPath: 'data[0].url',
      errorPath: 'error.message',
      pricePath: '',
      creditsPath: '',
      durationPath: '',
      unitPrice: null,
    },
  },
  {
    label: '自定义',
    kind: 'video',
    caps: [],
    model: '',
    gen: {
      submitURL: '',
      submitBody: `{
  "model": "{{model}}",
  "prompt": "{{prompt}}"
}`,
      pollURL: '',
      pollIntervalMs: 3000,
      timeoutMs: 300000,
      idPath: '',
      statusPath: '',
      successValues: 'success',
      failValues: 'failed',
      resultPath: '',
      errorPath: '',
      pricePath: '',
      creditsPath: '',
      durationPath: '',
      unitPrice: null,
    },
  },
]

export const emptyGenConfig = (): GenConfig => ({ ...GEN_PRESETS[GEN_PRESETS.length - 1].gen })
