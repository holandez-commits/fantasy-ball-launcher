// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    build: {
      rollupOptions: {
        // O build do Cloudflare tem limite de 1024 arquivos abertos (ulimit -n, fixo).
        // O padrão do Rollup 4 (1000 leituras em paralelo) + os ~1.700 ícones do lucide-react
        // estouravam o limite: "EMFILE: too many open files" / "failed to resolve import".
        maxParallelFileOps: 20,
      },
    },
  },
});
