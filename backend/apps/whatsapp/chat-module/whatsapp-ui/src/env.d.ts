/// <reference types="react" />
/// <reference types="react-dom" />

interface ImportMetaEnv {
    readonly VITE_API_BASE?: string;
    readonly VITE_AUTH_ENABLED?: string;
}
interface ImportMeta {
    readonly env: ImportMetaEnv;
}
