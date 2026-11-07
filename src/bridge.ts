import { parseProject, serialize, type Project } from './model';
export const desktop = '__TAURI_INTERNALS__' in window;
declare global { interface Window { __TAURI_INTERNALS__: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } } }
export const invoke = <T>(command: string, args: Record<string, unknown> = {}) => window.__TAURI_INTERNALS__.invoke<T>(command, args);
export interface OpenedProject { path: string; data: string; revision: string }
export const CACHE_KEY = 'alfie.project.v1';
export function cachedProject(): Project | null { const data = localStorage.getItem(CACHE_KEY); return data ? parseProject(data) : null; }
export function cacheProject(p: Project) { localStorage.setItem(CACHE_KEY, serialize(p)); }
export function download(name: string, data: string, type = 'application/json') { const url = URL.createObjectURL(new Blob([data], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export async function fullScreen(enable: boolean) {
  if (desktop) await invoke('fullscreen', { enabled: enable });
  else if (enable && !document.fullscreenElement) await document.documentElement.requestFullscreen();
  else if (!enable && document.fullscreenElement) await document.exitFullscreen();
}
