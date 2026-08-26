// 开发启动器：先拉起 Vite，端口通了再启动 Electron；任一方退出就一起收工。
import { spawn } from 'node:child_process'
import net from 'node:net'
import process from 'node:process'

const PORT = 5173
// Vite 绑定的是 localhost，在不同机器上可能落到 IPv6，两个都探
const HOSTS = ['127.0.0.1', '::1']
const isWin = process.platform === 'win32'
const npx = isWin ? 'npx.cmd' : 'npx'

function probe(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    const finish = (ok) => {
      socket.destroy()
      resolve(ok)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(1000, () => finish(false))
  })
}

async function waitForPort(port, hosts, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const host of hosts) {
      if (await probe(port, host)) return true
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

const vite = spawn(npx, ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: 'inherit',
  shell: isWin,
})

let electron = null
let shuttingDown = false

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  electron?.kill()
  vite.kill()
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
vite.on('close', () => shutdown(0))

if (!(await waitForPort(PORT, HOSTS))) {
  console.error(`\n[dev] Vite 在 60s 内没有监听 ${PORT} 端口，启动中止。`)
  shutdown(1)
}

console.log(`\n[dev] Vite 已就绪 http://localhost:${PORT} — 启动 Electron\n`)

// TESTHUB_INSPECT=1 npm run dev  → 开 DevTools 协议端口，方便外部调试/自动化
const electronArgs = ['electron', '.']
if (process.env.TESTHUB_INSPECT === '1') electronArgs.push('--remote-debugging-port=9222')

electron = spawn(npx, electronArgs, {
  stdio: 'inherit',
  shell: isWin,
  env: {
    ...process.env,
    TESTHUB_DEV: '1',
    VITE_DEV_SERVER_URL: `http://localhost:${PORT}`,
  },
})

electron.on('close', (code) => shutdown(code ?? 0))
