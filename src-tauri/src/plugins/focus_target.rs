//! 錄音開始時記住輸入目標（前景 App + 焦點元件），貼上前比對是否仍是同一個。
//!
//! 辨識較久或使用者手速快時，完成當下焦點可能已移到別的 App 或別的輸入框；
//! 此時不送 Cmd+V，改把文字留在剪貼簿讓使用者自行貼上（fork 自訂，macOS 限定）。

/// 貼上前比對結果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetMatch {
    /// 仍是錄音開始時的 App 與輸入框
    Same,
    /// 前景 App 或焦點元件已不同
    Changed,
    /// 讀不到（無擷取紀錄、AX 失敗），沿用原本直接貼上的行為
    Unknown,
}

/// 依 pid 與元件比對結果判定。`element_equal` 為 `None` 表示任一端讀不到焦點元件，只看 pid。
pub fn decide(saved_pid: i32, current_pid: i32, element_equal: Option<bool>) -> TargetMatch {
    if saved_pid != current_pid {
        return TargetMatch::Changed;
    }
    match element_equal {
        Some(false) => TargetMatch::Changed,
        _ => TargetMatch::Same,
    }
}

#[cfg(target_os = "macos")]
pub use macos_impl::{capture, compare, refocus, FocusTarget};

#[cfg(target_os = "macos")]
mod macos_impl {
    use super::{decide, TargetMatch};
    use core_foundation::base::{CFEqual, CFRelease, CFTypeRef, TCFType};
    use core_foundation::string::CFString;

    type AXUIElementRef = CFTypeRef;
    type AXError = i32;
    const K_AX_ERROR_SUCCESS: AXError = 0;
    /// AX 是同步跨進程呼叫，目標 App 卡住時預設會等 6 秒；這裡只做比對，等不到就當讀不到
    const AX_MESSAGING_TIMEOUT_SECS: f32 = 0.25;

    extern "C" {
        fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFTypeRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        fn AXUIElementSetMessagingTimeout(element: AXUIElementRef, timeout: f32) -> AXError;
        fn AXUIElementSetAttributeValue(
            element: AXUIElementRef,
            attribute: CFTypeRef,
            value: CFTypeRef,
        ) -> AXError;
    }

    /// 切回後等焦點落定的上限與輪詢間隔
    const REFOCUS_TIMEOUT_MS: u64 = 800;
    const REFOCUS_POLL_MS: u64 = 40;

    /// 持有一個 retain 過的 CF 物件，drop 時 release。
    struct OwnedCf(CFTypeRef);

    // AXUIElement 是不可變的 CF 參照，跨執行緒持有與比對是安全的
    unsafe impl Send for OwnedCf {}
    unsafe impl Sync for OwnedCf {}

    impl Drop for OwnedCf {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CFRelease(self.0) };
            }
        }
    }

    /// 錄音開始時的輸入目標。
    pub struct FocusTarget {
        pid: i32,
        element: Option<OwnedCf>,
    }

    fn copy_attribute(element: AXUIElementRef, name: &str) -> Option<OwnedCf> {
        let attr = CFString::new(name);
        let mut value: CFTypeRef = std::ptr::null();
        let err =
            unsafe { AXUIElementCopyAttributeValue(element, attr.as_CFTypeRef(), &mut value) };
        if err == K_AX_ERROR_SUCCESS && !value.is_null() {
            Some(OwnedCf(value))
        } else {
            None
        }
    }

    /// 前景 App 的 pid。用 NSWorkspace 而非 AX 系統層級的 AXFocusedApplication：
    /// 後者實測會回 kAXErrorCannotComplete（-25204），前者穩定。
    fn frontmost_pid() -> Option<i32> {
        unsafe {
            let workspace: *mut objc::runtime::Object =
                msg_send![class!(NSWorkspace), sharedWorkspace];
            if workspace.is_null() {
                return None;
            }
            let app: *mut objc::runtime::Object = msg_send![workspace, frontmostApplication];
            if app.is_null() {
                return None;
            }
            let pid: i32 = msg_send![app, processIdentifier];
            (pid > 0).then_some(pid)
        }
    }

    /// 讀目前的前景 App pid 與焦點元件；讀不到前景 App 回 None。
    pub fn capture() -> Option<FocusTarget> {
        let pid = frontmost_pid()?;
        let app = OwnedCf(unsafe { AXUIElementCreateApplication(pid) });
        if app.0.is_null() {
            return Some(FocusTarget { pid, element: None });
        }
        unsafe { AXUIElementSetMessagingTimeout(app.0, AX_MESSAGING_TIMEOUT_SECS) };
        let element = copy_attribute(app.0, "AXFocusedUIElement");
        Some(FocusTarget { pid, element })
    }

    fn set_bool_attribute(element: AXUIElementRef, name: &str) -> AXError {
        let attr = CFString::new(name);
        let value = core_foundation::boolean::CFBoolean::true_value();
        unsafe { AXUIElementSetAttributeValue(element, attr.as_CFTypeRef(), value.as_CFTypeRef()) }
    }

    /// 切回錄音開始時的 App 與輸入框，等到比對結果為 Same 才回 true。
    /// 同時用 NSRunningApplication 與 AX 的 AXFrontmost：前者在 SayIt 非作用中時可能被系統忽略。
    pub fn refocus(target: &FocusTarget) -> bool {
        unsafe {
            let app: *mut objc::runtime::Object = msg_send![
                class!(NSRunningApplication),
                runningApplicationWithProcessIdentifier: target.pid
            ];
            if app.is_null() {
                log::info!(
                    "[focus-target] refocus: app pid={} no longer running",
                    target.pid
                );
                return false;
            }
            // NSApplicationActivateIgnoringOtherApps = 1 << 1
            let _: bool = msg_send![app, activateWithOptions: 2u64];
        }
        let app_element = OwnedCf(unsafe { AXUIElementCreateApplication(target.pid) });
        if !app_element.0.is_null() {
            unsafe { AXUIElementSetMessagingTimeout(app_element.0, AX_MESSAGING_TIMEOUT_SECS) };
            let err = set_bool_attribute(app_element.0, "AXFrontmost");
            log::info!("[focus-target] refocus: set AXFrontmost → {err}");
        }
        if let Some(element) = &target.element {
            let err = set_bool_attribute(element.0, "AXFocused");
            log::info!("[focus-target] refocus: set AXFocused → {err}");
        }

        let deadline =
            std::time::Instant::now() + std::time::Duration::from_millis(REFOCUS_TIMEOUT_MS);
        loop {
            if compare(target) == TargetMatch::Same {
                return true;
            }
            if std::time::Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(std::time::Duration::from_millis(REFOCUS_POLL_MS));
        }
    }

    /// 比對目前焦點與錄音開始時的目標。
    pub fn compare(saved: &FocusTarget) -> TargetMatch {
        let Some(current) = capture() else {
            return TargetMatch::Unknown;
        };
        let element_equal = match (&saved.element, &current.element) {
            (Some(a), Some(b)) => Some(unsafe { CFEqual(a.0, b.0) } != 0),
            _ => None,
        };
        let result = decide(saved.pid, current.pid, element_equal);
        log::info!(
            "[focus-target] saved pid={} current pid={} element_equal={:?} → {:?}",
            saved.pid,
            current.pid,
            element_equal,
            result
        );
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decide_different_app_is_changed() {
        assert_eq!(decide(100, 200, Some(true)), TargetMatch::Changed);
        assert_eq!(decide(100, 200, None), TargetMatch::Changed);
    }

    #[test]
    fn test_decide_same_app_different_field_is_changed() {
        assert_eq!(decide(100, 100, Some(false)), TargetMatch::Changed);
    }

    #[test]
    fn test_decide_same_app_same_field_is_same() {
        assert_eq!(decide(100, 100, Some(true)), TargetMatch::Same);
    }

    #[test]
    fn test_decide_same_app_unknown_field_falls_back_to_same() {
        assert_eq!(decide(100, 100, None), TargetMatch::Same);
    }
}
