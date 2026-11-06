//! Minimal probe: Rust -> swift-rs-built Swift static lib -> FoundationModels.
#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::{c_char, c_void, CStr, CString};
    use std::sync::mpsc::{channel, Sender};
    use std::time::{Duration, Instant};

    extern "C" {
        fn sayit_fm_availability() -> i32;
        fn sayit_fm_build_info() -> *const c_char;
        fn sayit_fm_generate(
            request_json: *const c_char,
            ctx: *mut c_void,
            cb: extern "C" fn(*mut c_void, i32, *const c_char),
        ) -> i64;
        fn sayit_fm_cancel(handle: i64);
    }

    type Reply = (i32, String);

    extern "C" fn on_done(ctx: *mut c_void, kind: i32, payload: *const c_char) {
        // Reclaim the Box exactly once (callback contract: called exactly once).
        let tx: Box<Sender<Reply>> = unsafe { Box::from_raw(ctx as *mut Sender<Reply>) };
        let s = if payload.is_null() {
            String::new()
        } else {
            unsafe { CStr::from_ptr(payload) }.to_string_lossy().into_owned()
        };
        let _ = tx.send((kind, s));
    }

    struct Job {
        handle: i64,
        rx: std::sync::mpsc::Receiver<Reply>,
    }

    fn start(req: serde_json::Value) -> Job {
        let (tx, rx) = channel::<Reply>();
        let ctx = Box::into_raw(Box::new(tx)) as *mut c_void;
        let c = CString::new(req.to_string()).unwrap();
        let handle = unsafe { sayit_fm_generate(c.as_ptr(), ctx, on_done) };
        Job { handle, rx }
    }

    pub fn run() {
        let args: Vec<String> = std::env::args().collect();
        let info = unsafe { CStr::from_ptr(sayit_fm_build_info()) }.to_string_lossy().into_owned();
        let avail = unsafe { sayit_fm_availability() };
        println!("build_info={info} availability={avail}");
        if avail != 1 {
            println!("not available -> stop");
            return;
        }

        // 1) simple generation (zh-TW)
        let t = Instant::now();
        let job = start(serde_json::json!({
            "instructions": "你是文字整理助手，一律使用繁體中文（台灣用語）。只輸出整理後的文字。",
            "prompt": "那個我們明天下午三點在會議室開會嗯討論資料庫遷移的事情",
            "temperature": 0.0, "max_tokens": 200
        }));
        let (k, s) = job.rx.recv_timeout(Duration::from_secs(60)).expect("gen timeout");
        println!("[gen] handle={} kind={k} {:?} payload={s}", job.handle, t.elapsed());

        // 2) cancel a long generation after 300 ms
        let t = Instant::now();
        let job = start(serde_json::json!({
            "prompt": "請用繁體中文寫一篇三千字的文章，主題是台北的歷史。", "max_tokens": 4000
        }));
        std::thread::sleep(Duration::from_millis(300));
        unsafe { sayit_fm_cancel(job.handle) };
        let cancel_at = t.elapsed();
        let (k, s) = job.rx.recv_timeout(Duration::from_secs(120)).expect("cancel timeout");
        println!("[cancel] handle={} cancel_called_at={cancel_at:?} callback_after={:?} kind={k} payload={s}", job.handle, t.elapsed());

        // 3) cancel after completion is a harmless no-op
        unsafe { sayit_fm_cancel(job.handle) };
        unsafe { sayit_fm_cancel(999_999) };
        println!("[cancel-noop] ok");

        // 4) context overflow classification
        if args.iter().any(|a| a == "--overflow") {
            let big = "這是很長的文字，包含各式各樣的內容與變化。".repeat(4000);
            let job = start(serde_json::json!({ "prompt": big }));
            let (k, s) = job.rx.recv_timeout(Duration::from_secs(120)).expect("overflow timeout");
            println!("[overflow] kind={k} payload={}", s.chars().take(400).collect::<String>());
        }
    }

}

fn main() {
    #[cfg(target_os = "macos")]
    mac::run();
    #[cfg(not(target_os = "macos"))]
    println!("not macOS: Apple Intelligence bridge not compiled");
}
