/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO_AUTH?: string;
  readonly VITE_IDLE_MINUTES?: string;
  /** Simulated latency of the synthetic patient API in ms (Phase 2; default 150, tests use 0). */
  readonly VITE_MOCK_LATENCY_MS?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
