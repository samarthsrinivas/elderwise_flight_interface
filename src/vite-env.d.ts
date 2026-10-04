/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

declare module "node:fs" {
  export function readFileSync(path: string | URL, options?: string | { encoding?: string; flag?: string }): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
