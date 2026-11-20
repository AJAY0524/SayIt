import { check } from "@tauri-apps/plugin-updater";
import { open as openExternalUrl } from "@tauri-apps/plugin-shell";

/**
 * Fork 自建版只通知、不安裝上游更新：上游安裝包會覆蓋 fork 的自訂功能。
 * 通知來源仍是 tauri.conf.json 的上游 latest.json，使用者看完更新內容後再同步上游重建。
 */
const UPSTREAM_RELEASES_URL = "https://github.com/chenjackle45/SayIt/releases";

export function getUpstreamReleaseUrl(version: string): string {
  return version ? `${UPSTREAM_RELEASES_URL}/tag/v${version}` : UPSTREAM_RELEASES_URL;
}

export async function openUpstreamRelease(version: string): Promise<void> {
  await openExternalUrl(getUpstreamReleaseUrl(version));
}

export interface UpdateCheckResult {
  status: "up-to-date" | "update-available" | "error";
  version?: string;
  error?: string;
}

/**
 * 檢查 App 更新（僅檢查，不下載）。
 */
export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  try {
    const update = await check();
    if (!update) {
      console.log("[autoUpdater] No update available");
      return { status: "up-to-date" };
    }

    console.log(`[autoUpdater] Update available: v${update.version}`);
    return { status: "update-available", version: update.version };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[autoUpdater] Update check failed:", message);
    return { status: "error", error: message };
  }
}
