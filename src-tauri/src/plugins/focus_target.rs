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
pub use macos_impl::{capture, compare, FocusTarget};

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
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFTypeRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        fn AXUIElementGetPid(element: AXUIElementRef, pid: *mut i32) -> AXError;
        fn AXUIElementSetMessagingTimeout(element: AXUIElementRef, timeout: f32) -> AXError;
    }

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

    /// 讀目前的前景 App pid 與焦點元件；讀不到前景 App 回 None。
    pub fn capture() -> Option<FocusTarget> {
        let system_wide = OwnedCf(unsafe { AXUIElementCreateSystemWide() });
        if system_wide.0.is_null() {
            return None;
        }
        unsafe { AXUIElementSetMessagingTimeout(system_wide.0, AX_MESSAGING_TIMEOUT_SECS) };

        let app = copy_attribute(system_wide.0, "AXFocusedApplication")?;
        let mut pid: i32 = 0;
        if unsafe { AXUIElementGetPid(app.0, &mut pid) } != K_AX_ERROR_SUCCESS || pid <= 0 {
            return None;
        }
        unsafe { AXUIElementSetMessagingTimeout(app.0, AX_MESSAGING_TIMEOUT_SECS) };
        let element = copy_attribute(app.0, "AXFocusedUIElement");

        Some(FocusTarget { pid, element })
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
