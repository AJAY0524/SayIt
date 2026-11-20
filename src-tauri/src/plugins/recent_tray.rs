//! 系統匣選單的「最近紀錄」子選單：點一下就把那筆文字複製到剪貼簿（fork 自訂）。
//!
//! 貼錯地方或文字沒貼上時，不必開 Dashboard 就能取回最近幾筆。
//! 清單由前端（useHistoryStore）在新增、更新、刪除紀錄後推送。

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Manager, Runtime, State,
};

pub const TRAY_ID: &str = "sayit-tray";
const RECENT_ID_PREFIX: &str = "recent-";
/// 子選單最多顯示幾筆（前端也只送這麼多，這裡再擋一次）
pub const MAX_RECENT_ITEMS: usize = 5;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct RecentTrayItem {
    /// 選單上顯示的文字（前端已加時間、截斷）
    pub label: String,
    /// 點選後複製的完整文字
    pub text: String,
}

#[derive(Default)]
pub struct RecentTrayState {
    items: Mutex<Vec<RecentTrayItem>>,
}

/// 組出完整的系統匣選單：最近紀錄子選單、分隔線、開啟 Dashboard、結束。
pub fn build_tray_menu<R: Runtime>(
    app: &AppHandle<R>,
    items: &[RecentTrayItem],
) -> tauri::Result<Menu<R>> {
    let recent = Submenu::with_id(app, "recent", "最近紀錄（點選複製）", true)?;
    if items.is_empty() {
        recent.append(&MenuItem::with_id(
            app,
            "recent-empty",
            "（尚無紀錄）",
            false,
            None::<&str>,
        )?)?;
    } else {
        for (index, item) in items.iter().enumerate() {
            recent.append(&MenuItem::with_id(
                app,
                format!("{RECENT_ID_PREFIX}{index}"),
                &item.label,
                true,
                None::<&str>,
            )?)?;
        }
    }

    let open_dashboard_item =
        MenuItem::with_id(app, "open-dashboard", "開啟 Dashboard", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit SayIt", true, None::<&str>)?;
    Menu::with_items(
        app,
        &[
            &recent,
            &PredefinedMenuItem::separator(app)?,
            &open_dashboard_item,
            &quit_item,
        ],
    )
}

/// 解析 `recent-N` 選單 id，回傳 N。
pub fn parse_recent_index(menu_id: &str) -> Option<usize> {
    menu_id.strip_prefix(RECENT_ID_PREFIX)?.parse().ok()
}

/// 處理最近紀錄項目被點選：把該筆文字放進剪貼簿。
pub fn handle_recent_click<R: Runtime>(app: &AppHandle<R>, index: usize) {
    let state = app.state::<RecentTrayState>();
    let text = state
        .items
        .lock()
        .ok()
        .and_then(|items| items.get(index).map(|item| item.text.clone()));
    let Some(text) = text else {
        return;
    };
    match arboard::Clipboard::new().and_then(|mut clipboard| clipboard.set_text(text)) {
        Ok(()) => log::info!("[recent-tray] Copied recent item #{index} to clipboard"),
        Err(e) => log::error!("[recent-tray] Copy failed: {e}"),
    }
}

/// 前端推送最近紀錄清單，重建系統匣選單。
#[tauri::command]
pub fn set_recent_transcriptions<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, RecentTrayState>,
    items: Vec<RecentTrayItem>,
) -> Result<(), String> {
    let items: Vec<RecentTrayItem> = items.into_iter().take(MAX_RECENT_ITEMS).collect();
    let menu = build_tray_menu(&app, &items).map_err(|e| e.to_string())?;
    // 暫存清單與選單在同一把鎖內一起換，連續推送時兩者不會交錯對不上
    let mut guard = state.items.lock().map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    *guard = items;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_recent_index() {
        assert_eq!(parse_recent_index("recent-0"), Some(0));
        assert_eq!(parse_recent_index("recent-4"), Some(4));
        assert_eq!(parse_recent_index("recent-empty"), None);
        assert_eq!(parse_recent_index("open-dashboard"), None);
    }
}
