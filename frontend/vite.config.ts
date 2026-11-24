import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// mode
//  (기본)  : FastAPI(/api) 를 호출. 개발 시 :8000 으로 프록시
//  mock    : src/mock/bundle.json 으로 동작 (백엔드 없이 개발)
//  demo    : mock 데이터를 넣은 단일 HTML 파일 (dist-demo/index.html) — HTML 검증·공유용
export default defineConfig(({ mode }) => {
  const mock = mode === 'mock' || mode === 'demo';
  return {
    plugins: [react(), ...(mode === 'demo' ? [viteSingleFile()] : [])],
    define: { __DATA_MODE__: JSON.stringify(mock ? 'mock' : 'api') },
    server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8000' } },
    build: {
      outDir: mode === 'demo' ? 'dist-demo' : 'dist',
      chunkSizeWarningLimit: 4000,
    },
  };
});
