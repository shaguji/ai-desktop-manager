import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // koffi is a native addon; keep it external so it loads at runtime
        external: ['koffi']
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        external: ['electron'],
        /* 双入口：index = 桌面/设置窗口（完整能力），notes = 归墨笔记窗口（受限） */
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          notes: resolve(__dirname, 'src/preload/notes.ts')
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    },
    plugins: [react()]
  }
})
