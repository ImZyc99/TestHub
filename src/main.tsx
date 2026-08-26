import React from 'react'
import { createRoot } from 'react-dom/client'

// 字体全部本地打包 —— 生产构建的 CSP 不允许外链
import '@fontsource/poppins/latin-400.css'
import '@fontsource/poppins/latin-500.css'
import '@fontsource/poppins/latin-600.css'
import '@fontsource/poppins/latin-700.css'
import '@fontsource/poppins/latin-800.css'
// SOFT 轴的斜体，圆润末端，用来做品牌字
import '@fontsource-variable/fraunces/soft-italic.css'

// 语法高亮的配色写在 styles.css 里，跟着主题变量走，不引 highlight.js 的固定主题
import './styles.css'
import App from './App'
import { startPersistence } from './store'

startPersistence()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
