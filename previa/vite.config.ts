import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, '../src') } },
  server: { host: '127.0.0.1', port: 5199, fs: { allow: [path.resolve(__dirname, '..')] } },
  css: { postcss: path.resolve(__dirname, '..') },
});
