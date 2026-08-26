// 打包前自检：确认不会把个人数据打进分发给别人的产物里。
// 任何一条不通过就中止打包 —— 宁可打不出来，也别把 API Key 发出去。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const problems = []
const notes = []

/** electron-builder 的 files 白名单里真正会被打进产物的目录 */
const PACKED = ['dist', 'electron', 'package.json']

/** 个人数据文件名 */
const DATA_FILES = ['config.json', 'secrets.json', 'datadir.json']

/** 明显是密钥的形态 */
const SECRET_PATTERNS = [
  { re: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, label: 'API Key（sk-/pk-/rk- 开头）' },
  { re: /"(?:apiKey|api_key|secretKey|accessToken)"\s*:\s*"[^"]{8,}"/gi, label: '配置里的密钥字段' },
  { re: /\benc:[A-Za-z0-9+/]{40,}={0,2}/g, label: '加密后的密钥（enc: 前缀）' },
  { re: /\bb64:[A-Za-z0-9+/]{20,}={0,2}/g, label: '混淆后的密钥（b64: 前缀）' },
]

function walk(dir, out = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      walk(full, out)
    } else {
      out.push(full)
    }
  }
  return out
}

/* ---------------------------------------------------------------- *
 * 1. 会被打包的目录里不能出现个人数据文件
 * ---------------------------------------------------------------- */
const packedFiles = []
for (const target of PACKED) {
  const full = path.join(root, target)
  if (!fs.existsSync(full)) continue
  if (fs.statSync(full).isDirectory()) packedFiles.push(...walk(full))
  else packedFiles.push(full)
}

for (const file of packedFiles) {
  if (DATA_FILES.includes(path.basename(file))) {
    problems.push(`产物目录里有个人数据文件：${path.relative(root, file)}`)
  }
}

/* ---------------------------------------------------------------- *
 * 2. 会被打包的文件内容里不能出现密钥形态的字符串
 * ---------------------------------------------------------------- */
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.css', '.map', '.txt'])
for (const file of packedFiles) {
  if (!TEXT_EXT.has(path.extname(file))) continue
  let content
  try {
    content = fs.readFileSync(file, 'utf8')
  } catch {
    continue
  }
  for (const { re, label } of SECRET_PATTERNS) {
    re.lastIndex = 0
    const hit = re.exec(content)
    if (hit) {
      problems.push(`${path.relative(root, file)} 里疑似含有${label}：${hit[0].slice(0, 24)}…`)
    }
  }
}

/* ---------------------------------------------------------------- *
 * 3. 项目目录下不该散落个人数据（可能被误加进 files 白名单）
 * ---------------------------------------------------------------- */
for (const name of DATA_FILES) {
  const stray = path.join(root, name)
  if (fs.existsSync(stray)) {
    problems.push(`项目根目录有 ${name} —— 挪走或删掉再打包`)
  }
}

/* ---------------------------------------------------------------- *
 * 4. 用户是否把数据目录指到了项目里面
 * ---------------------------------------------------------------- */
const userDataGuesses = [
  path.join(os.homedir(), 'Library', 'Application Support', 'testhub'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'testhub'),
  path.join(os.homedir(), '.config', 'testhub'),
]
for (const guess of userDataGuesses) {
  const pointer = path.join(guess, 'datadir.json')
  if (!fs.existsSync(pointer)) continue
  try {
    const dir = JSON.parse(fs.readFileSync(pointer, 'utf8'))?.dir
    if (typeof dir !== 'string') continue
    const rel = path.relative(root, dir)
    const inside = rel && !rel.startsWith('..') && !path.isAbsolute(rel)
    if (inside) {
      problems.push(`数据目录被设到了项目里面（${dir}），先在「设置 → 数据存放位置」挪出去`)
    } else {
      notes.push(`数据目录：${dir}（在项目之外，不会被打包）`)
    }
  } catch {
    /* 指针文件坏了就忽略 */
  }
}

if (notes.length === 0) {
  notes.push('数据目录：默认位置（在项目之外，不会被打包）')
}

/* ---------------------------------------------------------------- */

console.log('\n[preflight] 打包前个人数据自检')
console.log(`[preflight] 扫描了 ${packedFiles.length} 个将被打进产物的文件`)
for (const n of notes) console.log(`[preflight] ${n}`)

if (problems.length > 0) {
  console.error('\n[preflight] ❌ 发现问题，已中止打包：\n')
  for (const p of problems) console.error(`  · ${p}`)
  console.error('')
  process.exit(1)
}

console.log('[preflight] ✅ 未发现 API Key、对话记录或 system prompt —— 可以安全分发\n')
