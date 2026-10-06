import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// 构建时间戳：注入为全局常量，在设置页显示，便于确认设备上跑的是哪一版。
// 显式按 UTC+8 格式化，避免 CI（UTC）构建出来的时间与本地部署时间对不上。
const buildStamp = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ')

export default defineConfig({
  // 用相对路径：GitHub Pages 的项目站点在 https://<用户名>.github.io/<仓库名>/ 这种
  // 子路径下，绝对路径 '/' 会让资源和 service worker 全部 404。
  // 相对路径对本地开发、项目站点、自定义域名三种情况都成立。
  base: './',
  define: {
    __BUILD_STAMP__: JSON.stringify(buildStamp)
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'ETF 投资跟踪',
        short_name: 'ETF跟踪',
        description: '离线优先的 ETF 定投与入金跟踪工具',
        lang: 'zh-CN',
        // 与 base 一致用相对路径，避免子路径部署时清单指向站点根
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f6f7f4',
        theme_color: '#f6f7f4',
        icons: [{ src: './icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
      },
      workbox: {
        // 预缓存清单由构建产物自动生成，不需要手写文件名，
        // 也不会出现「改了 dist 但忘记升 CACHE 版本」导致的陈旧缓存。
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
        navigateFallback: 'index.html',
        // 行情接口是跨域请求，直接放行给网络，绝不缓存：
        // 缓存会让「更新行情」读到旧响应，看起来像一直不更新。
        runtimeCaching: []
      }
    })
  ],
  build: {
    assetsDir: 'assets'
  }
})
