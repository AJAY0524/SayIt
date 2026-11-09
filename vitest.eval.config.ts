import { defineConfig } from "vitest/config";

/**
 * 文字整理實打評測專用設定（wayfinder #33）。
 * 不進 CI、不納入 `pnpm test`；用 `pnpm eval:cleanup` 手動執行。
 * environment 用 node，才能直接用 Node 內建 fetch 打 Anthropic API。
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/eval/**/*.eval.ts"],
    // 30 案 × N 次 × 多個提示詞版本，整體可能跑數分鐘
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 60 * 1000,
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
});
