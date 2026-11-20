import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCheck = vi.fn();
const mockOpen = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mockCheck,
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: mockOpen,
}));

describe("autoUpdater.ts", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCheck.mockReset();
    mockOpen.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("[P0] 無更新時應回傳 up-to-date", async () => {
    mockCheck.mockResolvedValue(null);

    const { checkForAppUpdate } = await import("../../src/lib/autoUpdater");
    const result = await checkForAppUpdate();

    expect(result).toEqual({ status: "up-to-date" });
    expect(mockCheck).toHaveBeenCalledOnce();
  });

  it("[P0] 有更新時應回傳 update-available 且不觸發下載", async () => {
    const mockDownload = vi.fn().mockResolvedValue(undefined);
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: vi.fn(),
    });

    const { checkForAppUpdate } = await import("../../src/lib/autoUpdater");
    const result = await checkForAppUpdate();

    expect(result).toEqual({ status: "update-available", version: "1.2.0" });
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("[P0] check 失敗應回傳 error 結果且不拋錯", async () => {
    mockCheck.mockRejectedValue(new Error("Network error"));

    const { checkForAppUpdate } = await import("../../src/lib/autoUpdater");
    const result = await checkForAppUpdate();

    expect(result).toEqual({ status: "error", error: "Network error" });
    expect(console.error).toHaveBeenCalledWith(
      "[autoUpdater] Update check failed:",
      "Network error",
    );
  });

  it("[P0] fork 自建版：發現新版只回報版本，不下載也不安裝", async () => {
    const mockDownload = vi.fn();
    const mockInstall = vi.fn();
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: mockInstall,
    });

    const autoUpdater = await import("../../src/lib/autoUpdater");
    const result = await autoUpdater.checkForAppUpdate();

    expect(result).toEqual({ status: "update-available", version: "1.2.0" });
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockInstall).not.toHaveBeenCalled();
    // 模組不再提供任何安裝入口，避免上游安裝包蓋掉 fork 自訂功能
    expect(autoUpdater).not.toHaveProperty("downloadUpdate");
    expect(autoUpdater).not.toHaveProperty("installAndRelaunch");
    expect(autoUpdater).not.toHaveProperty("downloadInstallAndRelaunch");
  });

  it("[P0] openUpstreamRelease 開啟上游對應版本的 release 頁", async () => {
    const { openUpstreamRelease, getUpstreamReleaseUrl } = await import(
      "../../src/lib/autoUpdater"
    );
    await openUpstreamRelease("0.14.3");

    expect(mockOpen).toHaveBeenCalledWith(
      "https://github.com/chenjackle45/SayIt/releases/tag/v0.14.3",
    );
    expect(getUpstreamReleaseUrl("")).toBe(
      "https://github.com/chenjackle45/SayIt/releases",
    );
  });
});
