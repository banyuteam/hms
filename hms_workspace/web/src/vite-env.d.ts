/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `true` = the static demo accounts are compiled in (login/logout demo only, NOT authentication). */
  readonly VITE_DEMO_AUTH?: string;
  readonly VITE_IDLE_MINUTES?: string;
  /** Simulated latency of the synthetic data adapter in ms (default 150, tests use 0). */
  readonly VITE_MOCK_LATENCY_MS?: string;
  /** `bff` (historical name) = real data and sign-in through hms_services (same origin); anything else = synthetic data. */
  readonly VITE_DATA_SOURCE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
