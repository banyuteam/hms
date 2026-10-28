/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO_AUTH?: string;
  readonly VITE_IDLE_MINUTES?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
