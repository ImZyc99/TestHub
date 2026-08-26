'use strict'

const { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, shell, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const isDev = process.env.TESTHUB_DEV === '1'
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'

// 未打包运行时 Electron 用的是自己的名字（Dock 提示、通知、关于面板都显示 "Electron"）。
// 改名会连带改变 userData 路径，所以先把当前路径读出来钉住，免得已有数据被甩掉。
{
  const currentUserData = app.getPath('userData')
  app.setName('TestHub')
  app.setPath('userData', currentUserData)
}

/** @type {BrowserWindow | null} */
let mainWindow = null

// 生成结果（视频/图片）用自定义协议喂给渲染进程。
// 开发模式页面来自 http://localhost，Chromium 会以「URL safety check」拒掉
// 页面里的 file:// 资源 —— 文件明明下载好了，播放器却一片黑。
// 自定义协议不受这个限制，打包后也一样能用。必须在 app ready 前注册。
protocol.registerSchemesAsPrivileged([
  { scheme: 'thmedia', privileges: { stream: true, supportFetchAPI: true } },
])

/* ------------------------------------------------------------------ *
 * 本地存储：config.json（非敏感状态） + secrets.json（加密的 API Key）
 * ------------------------------------------------------------------ */

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** 0600 写入：同机其他用户读不到对话记录，也读不到密钥文件 */
function writeJSONAtomic(file, data) {
  const tmp = `${file}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, file)
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    /* 某些文件系统（如挂载的 exFAT）不支持权限位，忽略 */
  }
}

/* ---- 数据目录：默认在 userData，用户可以改到别处 ---- */

// 指针文件永远留在默认位置，否则换了目录就找不到新位置在哪
const pointerPath = () => path.join(app.getPath('userData'), 'datadir.json')
let dataDirCache = null

function dataDir() {
  if (dataDirCache) return dataDirCache
  const saved = readJSON(pointerPath(), null)
  const candidate = typeof saved?.dir === 'string' ? saved.dir : null
  // 目录可能被用户删掉或所在磁盘没挂载，回退到默认位置而不是崩掉
  dataDirCache = candidate && fs.existsSync(candidate) ? candidate : app.getPath('userData')
  return dataDirCache
}

function setDataDir(dir) {
  writeJSONAtomic(pointerPath(), { dir })
  dataDirCache = dir
}

const isDefaultDir = () => path.resolve(dataDir()) === path.resolve(app.getPath('userData'))
const configPath = () => path.join(dataDir(), 'config.json')
const secretsPath = () => path.join(dataDir(), 'secrets.json')

function encryptValue(plain) {
  if (!plain) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return `enc:${safeStorage.encryptString(plain).toString('base64')}`
    }
  } catch {
    /* 落到 base64 兜底 */
  }
  return `b64:${Buffer.from(plain, 'utf8').toString('base64')}`
}

function decryptValue(stored) {
  if (!stored) return ''
  try {
    if (stored.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    }
    if (stored.startsWith('b64:')) {
      return Buffer.from(stored.slice(4), 'base64').toString('utf8')
    }
  } catch {
    return ''
  }
  return ''
}

const loadSecrets = () => readJSON(secretsPath(), {})
const getApiKey = (modelId) => decryptValue(loadSecrets()[modelId])

/** 把可能出现在报错文本里的密钥打码 —— 有些上游会把 Authorization 原样回显 */
function redact(text, ...secrets) {
  let out = String(text ?? '')
  for (const s of secrets) {
    if (typeof s === 'string' && s.length >= 8) out = out.split(s).join('••••')
  }
  return out
    .replace(/\b((?:sk|pk|rk)-)[A-Za-z0-9_-]{8,}/gi, '$1••••')
    .replace(/(Bearer\s+)[\w.-]{8,}/gi, '$1••••')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|key)=)[^&\s"']+/gi, '$1••••')
}

/**
 * 主进程自己的模型登记表。
 * 密钥只会发往这里登记的地址 —— 不采信渲染进程随请求传来的 baseURL，
 * 否则任何能在渲染进程执行代码的东西都能把密钥送去任意服务器。
 */
const modelRegistry = new Map()

function sanitizeModel(m) {
  if (!m || typeof m.id !== 'string' || typeof m.model !== 'string') return null
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const str = (v) => (typeof v === 'string' ? v : '')
  const kind = ['text', 'image', 'video'].includes(m.kind) ? m.kind : 'text'

  // 文本模型必须有 baseURL；生成模型走 gen.submitURL
  if (kind === 'text' && typeof m.baseURL !== 'string') return null

  const clean = {
    id: m.id,
    name: typeof m.name === 'string' ? m.name : m.id,
    baseURL: str(m.baseURL),
    model: m.model,
    temperature: num(m.temperature),
    maxTokens: num(m.maxTokens),
    reasoningEffort: ['low', 'medium', 'high'].includes(m.reasoningEffort) ? m.reasoningEffort : null,
    kind,
  }

  if (kind !== 'text') {
    const g = m.gen
    if (!g || typeof g.submitURL !== 'string' || !g.submitURL.trim()) return null
    clean.gen = {
      submitURL: g.submitURL,
      submitBody: str(g.submitBody),
      pollURL: str(g.pollURL),
      pollIntervalMs: num(g.pollIntervalMs) ?? 3000,
      timeoutMs: num(g.timeoutMs) ?? 300000,
      idPath: str(g.idPath),
      statusPath: str(g.statusPath),
      successValues: str(g.successValues),
      failValues: str(g.failValues),
      resultPath: str(g.resultPath),
      errorPath: str(g.errorPath),
      pricePath: str(g.pricePath),
      creditsPath: str(g.creditsPath),
      durationPath: str(g.durationPath),
      unitPrice: num(g.unitPrice),
    }
  }
  return clean
}

function syncRegistry(models) {
  modelRegistry.clear()
  for (const m of Array.isArray(models) ? models : []) {
    const clean = sanitizeModel(m)
    if (clean) modelRegistry.set(clean.id, clean)
  }
}

/** 落盘前剥掉任何形态的密钥字段，config.json 永远不该出现明文 */
function stripSecrets(state) {
  if (!state || typeof state !== 'object') return state
  const models = Array.isArray(state.models)
    ? state.models.map((m) => {
        const copy = { ...m }
        for (const field of ['apiKey', 'api_key', 'key', 'secret', 'token', 'hasKey']) delete copy[field]
        return copy
      })
    : []
  return { ...state, models }
}

/* ------------------------------------------------------------------ *
 * OpenAI 兼容协议客户端
 * ------------------------------------------------------------------ */

function normalizeBase(baseURL) {
  const raw = String(baseURL || '').trim().replace(/\/+$/, '')
  if (!raw) throw new Error('未填写 API 地址（Base URL）')
  if (!/^https?:\/\//i.test(raw)) throw new Error('API 地址必须以 http:// 或 https:// 开头')
  return raw
}

function chatEndpoint(baseURL) {
  const base = normalizeBase(baseURL)
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`
}

function modelsEndpoint(baseURL) {
  const base = normalizeBase(baseURL).replace(/\/chat\/completions$/, '')
  return `${base}/models`
}

function buildHeaders(apiKey) {
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

function truncate(text, max = 600) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/**
 * 从错误体里掏出真正有用的那一句。
 * 网关常见套娃：error.message 本身又是一段 JSON 字符串（有的网关有用的信息埋在 original_error 里），所以要一层层剥。
 */
// real_message 排最前：有的网关会在最内层附一个已经剥好的纯文本，
// 比 original_error（还是一层 JSON）直接得多
const ERROR_FIELDS = [
  'real_message',
  'original_error',
  'message',
  'error_msg',
  'msg',
  'detail',
  'other_err',
  'reason',
]

/** 尾巴上的 request id 对用户没意义，砍掉 */
function trimNoise(text) {
  return String(text)
    // 先吃掉整个 (request id: xxx) 括号块，再兜底裸写的形式
    .replace(/[（(]\s*(?:request[ _]?id|请求\s?id)\s*[:：]\s*[^）)]*[）)]/gi, '')
    .replace(/[.,;]?\s*(?:request[ _]?id|请求\s?id)\s*[:：]\s*\S+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function extractErrorText(value, depth = 0) {
  if (value === undefined || value === null) return ''
  // 实测有的网关报错能套到 6 层 JSON 字符串。解析出来的结构不可能有环，
  // 深度天然由报文本身限定，所以上限给宽一点；到底了就把手上的字符串交出去，
  // 不要返回空 —— 返回空会让上层退回最外层那坨原始 JSON。
  if (depth > 20) return typeof value === 'string' ? trimNoise(value.trim()) : ''
  if (typeof value === 'string') {
    const t = value.trim()
    // 是一段 JSON 就继续往里剥，不是就它了
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        return extractErrorText(JSON.parse(t), depth + 1) || t
      } catch {
        return t
      }
    }
    return trimNoise(t)
  }
  if (typeof value !== 'object') return String(value)

  for (const key of ERROR_FIELDS) {
    if (key in value) {
      const got = extractErrorText(value[key], depth + 1)
      if (got) return got
    }
  }
  if ('error' in value) {
    const got = extractErrorText(value.error, depth + 1)
    if (got) return got
  }
  return ''
}

/** 顺带把 code 捞出来 —— image_missing 这种比长句更好定位 */
function extractErrorCode(value, depth = 0) {
  if (depth > 20 || !value) return ''
  if (typeof value === 'string') {
    const t = value.trim()
    if (!t.startsWith('{')) return ''
    try {
      return extractErrorCode(JSON.parse(t), depth + 1)
    } catch {
      return ''
    }
  }
  if (typeof value !== 'object') return ''
  if (typeof value.code === 'string' && value.code) return value.code
  for (const key of ['error', 'message', 'data']) {
    if (key in value) {
      const got = extractErrorCode(value[key], depth + 1)
      if (got) return got
    }
  }
  return ''
}

/** 把上游返回的错误体整理成人话 */
async function describeHttpError(res, usedKey) {
  const text = await res.text().catch(() => '')
  let detail = text
  let code = ''
  try {
    const parsed = JSON.parse(text)
    detail = extractErrorText(parsed) || text
    code = extractErrorCode(parsed)
  } catch {
    /* 保持原始文本 */
  }
  if (code && detail && !detail.includes(code)) detail = `${detail}（${code}）`
  const hint =
    res.status === 401 || res.status === 403
      ? '（API Key 可能无效或没有权限）'
      : res.status === 404
        ? '（检查 Base URL 是否漏了 /v1，或模型 ID 是否写错）'
        : res.status === 429
          ? '（触发限流或余额不足）'
          : ''
  const line = `HTTP ${res.status} ${res.statusText || ''} ${hint} ${detail ? `— ${truncate(detail)}` : ''}`.trim()
  return redact(line, usedKey)
}

/** Node 的 fetch 把网络层错误都压成 "fetch failed"，真实原因在 cause 里 */
function describeError(err, usedKey) {
  const message = redact(err?.message || err, usedKey)
  const code = err?.cause?.code || err?.cause?.errors?.[0]?.code
  if (!code) return message

  const friendly = {
    ECONNREFUSED: '连接被拒绝 — 地址或端口不对，本地服务的话确认它已经启动',
    ENOTFOUND: '域名解析不了 — 检查 Base URL 拼写',
    ETIMEDOUT: '连接超时 — 检查网络或代理',
    ECONNRESET: '连接被重置 — 可能被网络中间层掐断',
    CERT_HAS_EXPIRED: '对方证书已过期',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'HTTPS 证书验证失败',
  }[code]

  return friendly ? `${friendly}（${code}）` : `${message}（${code}）`
}

function buildBody({ model, messages, temperature, maxTokens, reasoningEffort, stream }) {
  const body = { model, messages, stream }
  if (typeof temperature === 'number' && Number.isFinite(temperature)) body.temperature = temperature
  if (typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0) body.max_tokens = maxTokens
  // 只在用户明确选了档位时才带 —— 不支持这个字段的上游会直接报 400
  if (['low', 'medium', 'high'].includes(reasoningEffort)) body.reasoning_effort = reasoningEffort
  if (stream) body.stream_options = { include_usage: true }
  return body
}

/** 正在进行中的请求：requestId -> AbortController */
const controllers = new Map()

/**
 * @param entry 来自 modelRegistry 的登记项 —— baseURL 由主进程决定，不接受渲染进程指定
 */
async function streamChat(sender, requestId, entry, messages) {
  const emit = (msg) => {
    if (sender && !sender.isDestroyed()) sender.send('chat:event', { requestId, ...msg })
  }

  const controller = new AbortController()
  controllers.set(requestId, controller)
  const apiKey = getApiKey(entry.id)

  try {
    const res = await fetch(chatEndpoint(entry.baseURL), {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify(
        buildBody({
          model: entry.model,
          messages,
          temperature: entry.temperature,
          maxTokens: entry.maxTokens,
          reasoningEffort: entry.reasoningEffort,
          stream: true,
        }),
      ),
      signal: controller.signal,
    })

    if (!res.ok) throw new Error(await describeHttpError(res, apiKey))
    if (!res.body) throw new Error('上游没有返回数据流')

    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let usage = null
    let sawContent = false

    // SSE：逐行解析 data: 帧
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let idx
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line || line.startsWith(':')) continue
        if (!line.startsWith('data:')) continue

        const data = line.slice(5).trim()
        if (data === '[DONE]') continue

        let frame
        try {
          frame = JSON.parse(data)
        } catch {
          continue
        }

        if (frame.error) {
          throw new Error(frame.error.message || JSON.stringify(frame.error))
        }
        if (frame.usage) usage = frame.usage

        const delta = frame.choices?.[0]?.delta
        if (!delta) continue

        // DeepSeek-R1 / QwQ 等把思维链放在 reasoning_content
        const reasoning = delta.reasoning_content ?? delta.reasoning
        if (reasoning) emit({ type: 'reasoning', text: String(reasoning) })
        if (delta.content) {
          sawContent = true
          emit({ type: 'delta', text: String(delta.content) })
        }
      }
    }

    if (!sawContent) emit({ type: 'delta', text: '' })
    emit({ type: 'done', usage })
  } catch (err) {
    if (err && err.name === 'AbortError') emit({ type: 'aborted' })
    else emit({ type: 'error', message: describeError(err, apiKey) })
  } finally {
    controllers.delete(requestId)
  }
}


/* ------------------------------------------------------------------ *
 * 图像 / 视频生成：通用适配器
 *
 * 这两类没有统一协议，所以把「请求体模板 + 取值 JSON 路径」全交给用户配。
 * 流程：提交 → （可选）轮询 → 下载结果到本地 → 算价格
 * ------------------------------------------------------------------ */

/** 按点号路径取值，支持 data.output[0].url 这种写法 */
function pick(obj, path) {
  if (!path || obj == null) return undefined
  let cur = obj
  for (const seg of String(path).split('.')) {
    if (cur == null) return undefined
    const m = seg.match(/^([^[\]]*)((\[\d+\])*)$/)
    if (!m) return undefined
    if (m[1]) cur = cur[m[1]]
    for (const idx of (m[2] || '').match(/\d+/g) ?? []) {
      if (cur == null) return undefined
      cur = cur[Number(idx)]
    }
  }
  return cur
}

/**
 * 有些接口把 JSON 塞进字符串再返回（Vidu 的 extra_data 就是
 * "{\"credits\":4}"），所以取不到时试着把父级当 JSON 串解一次。
 */
function pickDeep(obj, path) {
  const direct = pick(obj, path)
  if (direct !== undefined) return direct
  const segs = String(path || '').split('.')
  for (let i = segs.length - 1; i > 0; i--) {
    const head = segs.slice(0, i).join('.')
    const tail = segs.slice(i).join('.')
    const raw = pick(obj, head)
    if (typeof raw === 'string') {
      try {
        const v = pick(JSON.parse(raw), tail)
        if (v !== undefined) return v
      } catch {
        /* 不是 JSON 串就算了 */
      }
    }
  }
  return undefined
}

const toNum = (v) => {
  const n = typeof v === 'string' ? Number(v.trim()) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * 渲染 {{占位符}}，结果必须仍是合法 JSON。三种情形分开处理：
 *   1. 整个字符串就是一个占位符  "{{duration}}"  → 值是数字就去掉引号
 *   2. 占位符嵌在更长的字符串里  "{{prompt}} --duration 4"  → 只做 JSON 转义，不加引号
 *   3. 裸占位符（不在字符串里）  "n": {{count}}  → 按 JSON 字面量插入
 */
/** 标记一段已经序列化好的 JSON 片段，渲染时原样插入而不再加引号/括号 */
const raw = (text) => ({ __raw: String(text) })
const isRaw = (v) => v !== null && typeof v === 'object' && typeof v.__raw === 'string'

function renderTemplate(tpl, vars) {
  const has = (k) => Object.prototype.hasOwnProperty.call(vars, k)

  // 情形 1：先把「独占一个字符串」的占位符换掉
  let out = String(tpl ?? '').replace(/"\{\{\s*(\w+)\s*\}\}"/g, (whole, key) => {
    if (!has(key)) return whole
    const v = vars[key]
    if (v === undefined || v === null) return 'null'
    if (isRaw(v)) return v.__raw
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    // 数组/对象（{{refs}} {{assets}}）整体替换成 JSON 字面量，
    // 不能走 String(v) —— 那会变成 "a,b" 这种没法用的字符串
    if (typeof v === 'object') return JSON.stringify(v)
    return JSON.stringify(String(v))
  })

  // 情形 2/3：剩下的按所处上下文决定要不要带引号
  out = out.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key, offset) => {
    if (!has(key)) return whole
    const v = vars[key]

    // 数一下前面有多少个「没被转义的」引号，奇数说明当前位置在字符串内部
    const before = out.slice(0, offset)
    let quotes = 0
    for (let i = 0; i < before.length; i++) {
      if (before[i] !== '"') continue
      let back = 0
      for (let j = i - 1; j >= 0 && before[j] === '\\'; j--) back++
      if (back % 2 === 0) quotes++
    }
    const inString = quotes % 2 === 1

    if (v === undefined || v === null) return inString ? '' : 'null'
    if (isRaw(v)) return inString ? v.__raw.replace(/"/g, '\\"') : v.__raw
    if (inString) {
      // 只转义，不加引号 —— 外面那对引号是模板自带的。
      // 数组/对象嵌在字符串里没有合理语义，退化成 JSON 文本
      const text = typeof v === 'object' ? JSON.stringify(v) : String(v)
      return JSON.stringify(text).slice(1, -1)
    }
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    if (typeof v === 'object') return JSON.stringify(v)
    return JSON.stringify(String(v))
  })

  return out
}

/** 逗号分隔的候选值，忽略大小写 */
const matches = (value, list) => {
  if (value === undefined || value === null) return false
  const v = String(value).trim().toLowerCase()
  return String(list || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .includes(v)
}

/** 结果文件存放目录 */
function mediaDir() {
  const dir = path.join(dataDir(), 'media')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

const EXT_BY_MIME = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

/** 把生成结果下载到本地 —— API 给的链接通常 24 小时就失效 */
async function downloadMedia(url, kind, signal) {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`下载结果失败：HTTP ${res.status}`)
  const mime = (res.headers.get('content-type') || '').split(';')[0].trim()
  let ext = EXT_BY_MIME[mime]
  if (!ext) {
    const fromUrl = (url.split('?')[0].match(/\.(mp4|webm|mov|png|jpe?g|webp|gif)$/i) || [])[0]
    ext = fromUrl ? fromUrl.toLowerCase() : kind === 'video' ? '.mp4' : '.png'
  }
  const name = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
  const dest = path.join(mediaDir(), name)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buf, { mode: 0o600 })
  return { localPath: dest, bytes: buf.length }
}

/** data URL / base64，给 {{image}} 占位符用 */
function imageToDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const mime =
    { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[
      ext
    ] || 'image/png'
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`
}

async function runGeneration(sender, requestId, entry, payload) {
  const emit = (msg) => {
    if (sender && !sender.isDestroyed()) sender.send('gen:event', { requestId, ...msg })
  }
  const controller = new AbortController()
  controllers.set(requestId, controller)
  const apiKey = getApiKey(entry.id)
  const g = entry.gen
  const startedAt = Date.now()
  const kind = entry.kind === 'image' ? 'image' : 'video'

  try {
    /* ---- 1. 组装请求体 ---- */
    const pp = payload.params || {}
    const dataUrl = (fp) => (typeof fp === 'string' && fp ? imageToDataUrl(fp) : null)
    // 参考图数组：{{refs}} 用数组形式，{{image}} 兼容旧模板取第一张
    const refPaths = Array.isArray(pp.refs) ? pp.refs.filter((x) => typeof x === 'string') : []
    const refUrls = refPaths.map(dataUrl).filter(Boolean)
    const firstFrame = dataUrl(pp.firstFrame)
    /**
     * 参考素材。图片可以内联 base64（多数网关接受）；视频/音频体积大，
     * 多数接口只收公网地址，所以有 url 就直接用 url，没有才尝试内联。
     */
    const ASSET_MIME = {
      mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
      mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
    }
    const fileToDataUrl = (fp) => {
      const ext = path.extname(fp).toLowerCase().slice(1)
      const mime = ASSET_MIME[ext]
      if (!mime) return dataUrl(fp)
      return `data:${mime};base64,${fs.readFileSync(fp).toString('base64')}`
    }
    const assets = (Array.isArray(pp.assets) ? pp.assets : [])
      .filter((a) => a && (typeof a.url === 'string' || typeof a.path === 'string'))
      .map((a) => {
        const kind = ['image', 'video', 'audio'].includes(a.kind) ? a.kind : 'image'
        const url = a.url || (a.path ? fileToDataUrl(a.path) : null)
        return url ? { kind, url, label: typeof a.label === 'string' ? a.label : '' } : null
      })
      .filter(Boolean)

    /**
     * 展开进 content 数组的图片项。Seedance 用 role 区分用途：
     * first_frame / last_frame / reference_image。
     * 输出的是「不带外层方括号」的片段，所以模板里写成
     *   "content": [ {文本项}, {{imageItems}} ]
     * 元素才会平铺进去而不是套一层数组。
     */
    const items = []
    if (firstFrame) items.push({ type: 'image_url', image_url: { url: firstFrame }, role: 'first_frame' })
    const lastUrl = dataUrl(pp.lastFrame)
    if (lastUrl) items.push({ type: 'image_url', image_url: { url: lastUrl }, role: 'last_frame' })
    for (const u of refUrls) items.push({ type: 'image_url', image_url: { url: u }, role: 'reference_image' })
    // 三类素材各自的 content 项形状不同：image_url / video_url / audio_url
    const TYPE_BY_KIND = {
      image: { type: 'image_url', field: 'image_url', role: 'reference_image' },
      video: { type: 'video_url', field: 'video_url', role: 'reference_video' },
      audio: { type: 'audio_url', field: 'audio_url', role: 'reference_audio' },
    }
    for (const a of assets) {
      const t = TYPE_BY_KIND[a.kind]
      items.push({ type: t.type, [t.field]: { url: a.url }, role: t.role })
    }
    // 没有旧式 refs 但传了单张 imagePath 时也补上，老模板照样能用
    if (items.length === 0 && payload.imagePath) {
      const u = dataUrl(payload.imagePath)
      if (u) items.push({ type: 'image_url', image_url: { url: u }, role: 'first_frame' })
    }

    // 有的网关不用 content 数组，而是三个平铺的 url 数组，两种都给出来
    const byKind = (k) => assets.filter((a) => a.kind === k).map((a) => a.url)
    const imageUrls = [...refUrls, ...byKind('image')]
    const videoUrls = byKind('video')
    const audioUrls = byKind('audio')

    const vars = {
      imageItems: raw(items.map((x) => JSON.stringify(x)).join(', ')),
      imageUrls,
      videoUrls,
      audioUrls,
      prompt: payload.prompt,
      model: entry.model,
      duration: pp.duration ?? null,
      size: pp.size ?? null,
      ratio: pp.ratio ?? null,
      resolution: pp.resolution ?? null,
      seed: pp.seed ?? null,
      // 单图占位符按「参考图 → 首帧 → 旧的 imagePath」的顺序取，老模板照样能用
      image: refUrls[0] ?? firstFrame ?? dataUrl(payload.imagePath),
      refs: refUrls,
      firstFrame,
      lastFrame: dataUrl(pp.lastFrame),
      assets,
    }
    // 提示词里的可选 flag（--resolution 之类）如果没取到值，会留下一个
    // 光秃秃的 --xxx，上游会当成非法参数。渲染完统一清掉。
    // 一张图都没选时，把 ", {{imageItems}}" 连同逗号一起抹掉，
    // 否则会留下 [ {...}, ] 这种尾逗号，JSON 直接解析失败
    let tpl = String(g.submitBody ?? '')
    if (items.length === 0) {
      tpl = tpl.replace(/,\s*\{\{\s*imageItems\s*\}\}/g, '').replace(/\{\{\s*imageItems\s*\}\}\s*,/g, '')
    }
    // 空的 url 数组：整行字段一起去掉，免得发出 "video_urls": [] 让上游误判
    for (const [key, arr] of [['imageUrls', imageUrls], ['videoUrls', videoUrls], ['audioUrls', audioUrls]]) {
      if (arr.length === 0) {
        tpl = tpl.replace(new RegExp(`,?\\s*"[\\w_]+"\\s*:\\s*\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), '')
      }
    }
    const cleaned = tpl.replace(
      /--(\w+)\s+\{\{\s*(\w+)\s*\}\}/g,
      (whole, flag, key) => (vars[key] === undefined || vars[key] === null || vars[key] === '' ? '' : whole),
    )
    const bodyText = renderTemplate(cleaned, vars)
    let body
    try {
      body = JSON.parse(bodyText)
    } catch (err) {
      throw new Error(`请求体模板不是合法 JSON：${err.message}`)
    }

    emit({ type: 'progress', text: '提交中…' })

    /* ---- 2. 提交 ---- */
    const submitRes = await fetch(g.submitURL, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!submitRes.ok) throw new Error(await describeHttpError(submitRes, apiKey))
    const submitJson = await submitRes.json()

    /* ---- 3. 轮询（pollURL 为空 = 同步接口，提交即出结果）---- */
    let final = submitJson
    if (g.pollURL && g.pollURL.trim()) {
      const taskId = pickDeep(submitJson, g.idPath)
      if (taskId === undefined || taskId === null || taskId === '') {
        throw new Error(
          `提交成功但取不到任务 id（路径 ${g.idPath}）。返回：${truncate(JSON.stringify(submitJson), 300)}`,
        )
      }
      // 任务 id 可能含 / ^ 等字符（实测火山返回的是
      // cgt-xxx^^volcengine/doubao-seedance-2-0-fast^^1），不编码会 404
      const pollUrl = g.pollURL.replace(/\{\{\s*id\s*\}\}/g, encodeURIComponent(String(taskId)))
      const interval = Math.max(1000, g.pollIntervalMs || 3000)
      const deadline = Date.now() + Math.max(10000, g.timeoutMs || 300000)

      for (;;) {
        if (Date.now() > deadline) throw new Error(`等待超时（${Math.round((g.timeoutMs || 300000) / 1000)}s）`)
        await new Promise((r) => setTimeout(r, interval))
        if (controller.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })

        const pollRes = await fetch(pollUrl, { headers: buildHeaders(apiKey), signal: controller.signal })
        if (!pollRes.ok) throw new Error(await describeHttpError(pollRes, apiKey))
        final = await pollRes.json()

        const status = pickDeep(final, g.statusPath)
        const secs = Math.round((Date.now() - startedAt) / 1000)
        emit({ type: 'progress', text: `${status ?? '生成中'} · ${secs}s` })

        if (matches(status, g.failValues)) {
          const why = pickDeep(final, g.errorPath)
          throw new Error(`生成失败：${why ?? status}`)
        }
        if (matches(status, g.successValues)) break
      }
    }

    /* ---- 4. 取结果 URL ---- */
    const url = pickDeep(final, g.resultPath)
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new Error(`取不到结果地址（路径 ${g.resultPath}）。返回：${truncate(JSON.stringify(final), 300)}`)
    }

    /* ---- 5. 下载到本地，避免链接过期后成死链 ---- */
    emit({ type: 'progress', text: '下载结果…' })
    let localPath
    try {
      localPath = (await downloadMedia(url, kind, controller.signal)).localPath
    } catch (err) {
      // 下载失败不算整体失败，至少把在线链接留给用户
      emit({ type: 'progress', text: `下载失败（${err.message}），仅保留链接` })
    }

    /* ---- 6. 算价格 ---- */
    let amount = toNum(pickDeep(final, g.pricePath))
    const credits = toNum(pickDeep(final, g.creditsPath))
    let source = amount !== null && amount > 0 ? 'amount' : null
    if (source === null && credits !== null && toNum(g.unitPrice) !== null) {
      amount = credits * toNum(g.unitPrice)
      source = 'credits'
    }
    // 时长优先读响应里的实际值（比提交值准），取不到再退回提交时填的
    const dur = toNum(pickDeep(final, g.durationPath)) ?? toNum(payload.params?.duration)
    const perSecond = kind === 'video' && amount !== null && dur ? amount / dur : null

    emit({
      type: 'done',
      media: { kind, url, localPath },
      cost: { amount, perSecond, credits, source },
    })
  } catch (err) {
    if (err && err.name === 'AbortError') emit({ type: 'aborted' })
    else emit({ type: 'error', message: describeError(err, apiKey) })
  } finally {
    controllers.delete(requestId)
  }
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */

function registerIpc() {
  ipcMain.handle('config:load', () => ({
    config: readJSON(configPath(), null),
    keyedModelIds: Object.keys(loadSecrets()),
    encryptionAvailable: (() => {
      try {
        return safeStorage.isEncryptionAvailable()
      } catch {
        return false
      }
    })(),
  }))

  ipcMain.handle('config:save', (_e, state) => {
    const safe = stripSecrets(state)
    writeJSONAtomic(configPath(), safe)
    syncRegistry(safe.models)
    return true
  })

  // 模型增删后渲染进程立刻同步一次，不用等防抖落盘 —— 否则刚加的模型发不出请求
  ipcMain.handle('models:sync', (_e, models) => {
    syncRegistry(models)
    return modelRegistry.size
  })

  ipcMain.handle('secret:set', (_e, { modelId, apiKey }) => {
    const secrets = loadSecrets()
    if (apiKey) secrets[modelId] = encryptValue(apiKey)
    else delete secrets[modelId]
    writeJSONAtomic(secretsPath(), secrets)
    return Object.keys(secrets)
  })

  ipcMain.handle('secret:clear', (_e, modelId) => {
    const secrets = loadSecrets()
    delete secrets[modelId]
    writeJSONAtomic(secretsPath(), secrets)
    return Object.keys(secrets)
  })

  ipcMain.handle('secret:list', () => Object.keys(loadSecrets()))

  // 设置面板里的「测试连接」：用一条极短的非流式请求验活
  ipcMain.handle('chat:test', async (_e, { modelId, baseURL, model, apiKey }) => {
    try {
      const key = apiKey || getApiKey(modelId)
      const res = await fetch(chatEndpoint(baseURL), {
        method: 'POST',
        headers: buildHeaders(key),
        body: JSON.stringify(
          buildBody({ model, messages: [{ role: 'user', content: 'ping' }], maxTokens: 16, stream: false }),
        ),
      })
      if (!res.ok) return { ok: false, message: await describeHttpError(res, key) }
      const json = await res.json()
      const reply = json?.choices?.[0]?.message?.content
      return { ok: true, message: `连接成功 · 模型回了：${truncate(reply || '(空)', 60)}` }
    } catch (err) {
      return { ok: false, message: describeError(err) }
    }
  })

  // 拉取该服务商的可用模型列表，方便填模型 ID
  ipcMain.handle('models:list', async (_e, { modelId, baseURL, apiKey }) => {
    try {
      const key = apiKey || getApiKey(modelId)
      const res = await fetch(modelsEndpoint(baseURL), { headers: buildHeaders(key) })
      if (!res.ok) return { ok: false, message: await describeHttpError(res, key) }
      const json = await res.json()
      const ids = (json?.data || json?.models || [])
        .map((m) => m?.id || m?.name)
        .filter(Boolean)
        .sort()
      return { ok: true, models: ids }
    } catch (err) {
      return { ok: false, message: describeError(err) }
    }
  })

  ipcMain.on('chat:send', (event, payload) => {
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId : null
    if (!requestId) return

    const emit = (msg) => {
      if (!event.sender.isDestroyed()) event.sender.send('chat:event', { requestId, ...msg })
    }

    const entry = modelRegistry.get(payload?.modelId)
    if (!entry) {
      emit({ type: 'error', message: '这个模型不在已保存的配置里，请到侧栏重新保存一次' })
      return
    }
    if (!Array.isArray(payload?.messages) || payload.messages.length === 0) {
      emit({ type: 'error', message: '请求内容为空' })
      return
    }

    const messages = payload.messages
      .filter((m) => m && typeof m.content === 'string' && ['system', 'user', 'assistant'].includes(m.role))
      .map((m) => ({ role: m.role, content: m.content }))

    if (messages.length === 0) {
      emit({ type: 'error', message: '请求内容格式不对' })
      return
    }

    streamChat(event.sender, requestId, entry, messages)
  })

  /* ---- 图像 / 视频生成 ---- */

  ipcMain.on('gen:send', (event, payload) => {
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId : null
    if (!requestId) return
    const emit = (msg) => {
      if (!event.sender.isDestroyed()) event.sender.send('gen:event', { requestId, ...msg })
    }
    const entry = modelRegistry.get(payload?.modelId)
    if (!entry) {
      emit({ type: 'error', message: '这个模型不在已保存的配置里，请到侧栏重新保存一次' })
      return
    }
    if (entry.kind === 'text' || !entry.gen) {
      emit({ type: 'error', message: '这是文本模型，不能用来生成图像或视频' })
      return
    }
    if (typeof payload?.prompt !== 'string' || !payload.prompt.trim()) {
      emit({ type: 'error', message: '提示词为空' })
      return
    }
    runGeneration(event.sender, requestId, entry, {
      prompt: payload.prompt,
      imagePath: typeof payload.imagePath === 'string' ? payload.imagePath : null,
      params: payload.params && typeof payload.params === 'object' ? payload.params : {},
    })
  })

  ipcMain.on('gen:abort', (_e, requestId) => {
    controllers.get(requestId)?.abort()
  })

  /** 选一张本地图片，顺便返回缩略用的 data URL */
  const PICK_FILTERS = {
    image: { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
    video: { name: '视频', extensions: ['mp4', 'mov', 'webm'] },
    audio: { name: '音频', extensions: ['mp3', 'wav', 'm4a', 'aac'] },
  }
  // 视频/音频内联成 base64 会把请求体撑爆（文档限 64MB），
  // 超过这个大小就只回路径，交给上层提示用户改用公网地址
  const INLINE_LIMIT = 12 * 1024 * 1024

  /** 按扩展名判断这是图、视频还是音频 */
  const kindOfFile = (fp) => {
    const ext = path.extname(fp).toLowerCase().slice(1)
    for (const [k, f] of Object.entries(PICK_FILTERS)) if (f.extensions.includes(ext)) return k
    return 'image'
  }

  ipcMain.handle('image:pick', async (_e, kind) => {
    // kind 传 'any'（或不传）时给一个混合选择器：参考素材本来就包含三类，
    // 不该先让用户挑「本地图片 / 本地视频 / 本地音频」
    const mixed = !['image', 'video', 'audio'].includes(kind)
    const filters = mixed
      ? [
          {
            name: '参考素材',
            extensions: Object.values(PICK_FILTERS).flatMap((f) => f.extensions),
          },
          ...Object.values(PICK_FILTERS),
        ]
      : [PICK_FILTERS[kind]]
    const res = await dialog.showOpenDialog(mainWindow, {
      title: mixed ? '选择参考素材（图片 / 视频 / 音频）' : `选择${PICK_FILTERS[kind].name}`,
      properties: ['openFile'],
      filters,
    })
    if (res.canceled || !res.filePaths?.[0]) return null
    const filePath = res.filePaths[0]
    const k = mixed ? kindOfFile(filePath) : kind
    const base = { path: filePath, name: path.basename(filePath), kind: k }
    try {
      const size = fs.statSync(filePath).size
      if (k !== 'image' && size > INLINE_LIMIT) {
        return { ...base, dataUrl: '', size, tooBig: true }
      }
      return { ...base, size, dataUrl: k === 'image' ? imageToDataUrl(filePath) : '' }
    } catch (err) {
      return { ...base, dataUrl: '', error: String(err?.message || err) }
    }
  })

  ipcMain.handle('path:open', async (_e, p) => {
    if (typeof p === 'string' && fs.existsSync(p)) await shell.openPath(p)
  })

  ipcMain.handle('path:reveal', (_e, p) => {
    if (typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p)
  })

  ipcMain.on('chat:abort', (_e, requestId) => {
    controllers.get(requestId)?.abort()
  })

  ipcMain.handle('app:openExternal', (_e, url) => {
    if (/^https?:\/\//i.test(String(url))) shell.openExternal(url)
  })

  /* ---- 数据目录：查看 / 打开 / 迁移 / 恢复默认 ---- */

  const dataInfo = () => ({
    dir: dataDir(),
    config: configPath(),
    secrets: secretsPath(),
    isDefault: isDefaultDir(),
    defaultDir: app.getPath('userData'),
  })

  ipcMain.handle('data:info', dataInfo)

  ipcMain.handle('data:reveal', async () => {
    if (fs.existsSync(configPath())) shell.showItemInFolder(configPath())
    else await shell.openPath(dataDir())
  })

  /**
   * 迁移到新目录。目标目录已经有 TestHub 数据时按「接管」处理 ——
   * 直接用那边的，不覆盖，免得把用户另一台机器同步过来的配置冲掉。
   */
  function moveDataTo(targetDir) {
    try {
      const from = dataDir()
      if (path.resolve(from) === path.resolve(targetDir)) return { ok: true, ...dataInfo(), moved: false }

      // 数据目录不能落在应用/项目目录里：那样打包分发时会把 API Key 和对话一起带给别人
      for (const base of [app.getAppPath(), process.resourcesPath].filter(Boolean)) {
        const rel = path.relative(path.resolve(base), path.resolve(targetDir))
        if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
          return {
            ok: false,
            message: '不能把数据放在应用目录里 —— 打包分发时会把你的 API Key 和对话一起带走，请换个位置。',
          }
        }
      }

      fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 })
      fs.accessSync(targetDir, fs.constants.W_OK)

      const adopted = fs.existsSync(path.join(targetDir, 'config.json'))
      if (!adopted) {
        for (const name of ['config.json', 'secrets.json']) {
          const src = path.join(from, name)
          if (!fs.existsSync(src)) continue
          const dest = path.join(targetDir, name)
          fs.copyFileSync(src, dest)
          try {
            fs.chmodSync(dest, 0o600)
          } catch {
            /* 文件系统不支持权限位 */
          }
          fs.rmSync(src, { force: true })
        }
      }

      setDataDir(targetDir)
      syncRegistry(readJSON(configPath(), {})?.models)
      return { ok: true, ...dataInfo(), moved: true, adopted }
    } catch (err) {
      return { ok: false, message: describeError(err) }
    }
  }

  ipcMain.handle('data:choose', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择 TestHub 的数据存放位置',
      message: '配置、提示词库、对话记录和加密后的 API Key 都会放在这里',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: dataDir(),
      buttonLabel: '存到这里',
    })
    if (res.canceled || !res.filePaths?.[0]) return { ok: false, canceled: true }
    return moveDataTo(res.filePaths[0])
  })

  ipcMain.handle('data:reset', () => moveDataTo(app.getPath('userData')))

  ipcMain.handle('app:paths', dataInfo)
}

/* ------------------------------------------------------------------ *
 * 窗口
 * ------------------------------------------------------------------ */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 880,
    minHeight: 600,
    show: false,
    backgroundColor: '#cbc0e5',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // 页面内的外链一律扔给系统浏览器，不在应用内开新窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    mainWindow.loadURL(DEV_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: 'TestHub',
      applicationVersion: app.getVersion(),
      credits: '多模型并行对话客户端',
    })
  }

  // 未打包运行时 Dock 会显示 Electron 自带的图标，这里手动换成自己的
  if (isDev && process.platform === 'darwin' && app.dock) {
    const devIcon = path.join(__dirname, '..', 'build', 'icon.png')
    if (fs.existsSync(devIcon)) app.dock.setIcon(devIcon)
  }

  // thmedia://<文件名> → 媒体目录下的那个文件。
  // 只认纯文件名：带路径分隔符或 .. 的一律拒绝，防止被拿去读任意文件。
  // 必须自己实现 Range 响应 —— 视频解码器按分段拉流，net.fetch(file://)
  // 不透传 Range，FFmpegDemuxer 会直接报 open context failed。
  const MEDIA_MIME = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  }
  protocol.handle('thmedia', (request) => {
    let name = ''
    try {
      name = decodeURIComponent(request.url.replace(/^thmedia:\/\//, '').split(/[?#]/)[0])
    } catch {
      return new Response('bad url', { status: 400 })
    }
    if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
      return new Response('forbidden', { status: 403 })
    }
    const file = path.join(mediaDir(), name)
    let stat
    try {
      stat = fs.statSync(file)
    } catch {
      return new Response('not found', { status: 404 })
    }
    const mime = MEDIA_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
    const range = request.headers.get('range')
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range)
      const start = m?.[1] ? Number(m[1]) : 0
      const end = m?.[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1
      if (!m || start > end || start >= stat.size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } })
      }
      const fd = fs.openSync(file, 'r')
      try {
        const buf = Buffer.alloc(end - start + 1)
        fs.readSync(fd, buf, 0, buf.length, start)
        return new Response(buf, {
          status: 206,
          headers: {
            'Content-Type': mime,
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Content-Length': String(buf.length),
            'Accept-Ranges': 'bytes',
          },
        })
      } finally {
        fs.closeSync(fd)
      }
    }
    return new Response(fs.readFileSync(file), {
      status: 200,
      headers: { 'Content-Type': mime, 'Content-Length': String(stat.size), 'Accept-Ranges': 'bytes' },
    })
  })

  // 渲染进程不需要联网（请求都在主进程发），生产环境锁死 CSP
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: thmedia:; media-src 'self' thmedia:; connect-src 'self'",
          ],
        },
      })
    })
  }

  // 旧版本写的文件是 0644，启动时收紧一次 —— 光改写入路径管不到已经存在的文件
  for (const file of [configPath(), secretsPath()]) {
    try {
      if (fs.existsSync(file)) fs.chmodSync(file, 0o600)
    } catch {
      /* 文件系统不支持权限位 */
    }
  }

  // 启动就把已保存的模型灌进登记表，用户不用先动一下配置才能发请求
  syncRegistry(readJSON(configPath(), {})?.models)

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
