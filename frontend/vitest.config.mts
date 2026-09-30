import { defineConfig } from "vitest/config";

// `npm test`      → pruebas unitarias (src/**/*.test.ts), sin red.
// `npm run test:e2e` → despliega el contrato en Testnet y ejercita la dApp (e2e/**/*.test.ts).
export default defineConfig(({ mode }) => {
  const e2e = mode === "e2e";

  return {
    test: {
      include: e2e ? ["e2e/**/*.test.ts"] : ["src/**/*.test.ts"],
      testTimeout: e2e ? 120_000 : 5_000,
      hookTimeout: e2e ? 300_000 : 10_000,
    },
  };
});
