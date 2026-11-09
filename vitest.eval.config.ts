import { execSync } from "node:child_process";
import { dirname } from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

/**
 * 實打金鑰：優先用環境變數 ANTHROPIC_API_KEY；沒設定時讀 repo 外層資料夾的 `.env`
 * （AJ 本機在那裡放 ANTHROPIC_API_KEY_SAYIT，不進 repo）。從 git common dir 回推，worktree 裡也找得到。
 */
function resolveEvalApiKey(): string | undefined {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const gitCommonDir = execSync(
      "git rev-parse --path-format=absolute --git-common-dir",
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const outerDir = dirname(dirname(gitCommonDir));
    const outerEnv = loadEnv("", outerDir, "ANTHROPIC_API_KEY");
    return outerEnv.ANTHROPIC_API_KEY || outerEnv.ANTHROPIC_API_KEY_SAYIT;
  } catch {
    return undefined;
  }
}

const evalApiKey = resolveEvalApiKey();

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
    env: evalApiKey ? { ANTHROPIC_API_KEY: evalApiKey } : {},
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
});
