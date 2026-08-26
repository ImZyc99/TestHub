'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,

  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (state) => ipcRenderer.invoke('config:save', state),

  setSecret: (modelId, apiKey) => ipcRenderer.invoke('secret:set', { modelId, apiKey }),
  clearSecret: (modelId) => ipcRenderer.invoke('secret:clear', modelId),
  listSecrets: () => ipcRenderer.invoke('secret:list'),

  testModel: (payload) => ipcRenderer.invoke('chat:test', payload),
  listModels: (payload) => ipcRenderer.invoke('models:list', payload),

  /** 模型增删后立刻同步给主进程，主进程据此决定密钥能发往哪些地址 */
  syncModels: (models) => ipcRenderer.invoke('models:sync', models),

  send: (payload) => ipcRenderer.send('chat:send', payload),
  abort: (requestId) => ipcRenderer.send('chat:abort', requestId),

  /** 返回取消订阅函数 */
  onChatEvent: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('chat:event', handler)
    return () => ipcRenderer.off('chat:event', handler)
  },

  /* ---- 图像 / 视频生成 ---- */
  genSend: (payload) => ipcRenderer.send('gen:send', payload),
  genAbort: (requestId) => ipcRenderer.send('gen:abort', requestId),
  onGenEvent: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('gen:event', handler)
    return () => ipcRenderer.off('gen:event', handler)
  },
  pickImage: (kind) => ipcRenderer.invoke('image:pick', kind),
  openPath: (p) => ipcRenderer.invoke('path:open', p),
  revealPath: (p) => ipcRenderer.invoke('path:reveal', p),

  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  paths: () => ipcRenderer.invoke('app:paths'),

  dataInfo: () => ipcRenderer.invoke('data:info'),
  dataReveal: () => ipcRenderer.invoke('data:reveal'),
  dataChoose: () => ipcRenderer.invoke('data:choose'),
  dataReset: () => ipcRenderer.invoke('data:reset'),
})
