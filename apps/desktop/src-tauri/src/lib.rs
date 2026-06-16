use std::io::{Read, Write};
use std::net::TcpListener;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_sql::{Migration, MigrationKind};

// ── Window helpers ─────────────────────────────────────────────────────────

fn note_label(id: &str) -> String {
    // Use '-' not ':' — ':' is illegal in Windows paths and WebView2 derives a
    // data-folder name from the label, so a ':' label yields a blank, hung note
    // window on Windows.
    format!("note-{id}")
}

/// Open (or focus) the floating window for a note. The React side reads the
/// window label to know which note to render, and creates the row if missing.
fn create_note_window(app: &AppHandle, id: &str) -> tauri::Result<()> {
    let label = note_label(id);
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Note")
        .decorations(false)
        // Transparency works well on macOS (rounded paper look). On Windows the
        // WebView2 transparent window renders blank/uninteractive, so keep note
        // windows opaque there.
        .transparent(cfg!(target_os = "macos"))
        .resizable(true)
        .inner_size(280.0, 280.0)
        .min_inner_size(180.0, 150.0)
        .build()?;
    Ok(())
}

/// Open (or focus) the board / manager window.
fn open_board_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("board") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "board", WebviewUrl::App("index.html".into()))
        .title("Msticky")
        .inner_size(840.0, 620.0)
        .min_inner_size(420.0, 360.0)
        .build()?;
    Ok(())
}

// On Windows, WebviewWindowBuilder::build() DEADLOCKS when called on the
// event-loop thread (synchronous commands, tray/shortcut handlers) — the webview
// then never initializes and the window stays blank/frozen. Building from a
// spawned thread (or an async command) sidesteps the deadlock. See wry#583.
fn new_note_window(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let id = uuid::Uuid::new_v4().to_string();
        let _ = create_note_window(&app, &id);
    });
}

fn spawn_open_board(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let _ = open_board_window(&app);
    });
}

// ── Commands invoked from JS ────────────────────────────────────────────────

// `async` so Tauri runs these off the event-loop thread — required on Windows,
// where building a webview window on that thread deadlocks (see above).
#[tauri::command]
async fn open_note_window(app: AppHandle, id: String) -> Result<(), String> {
    create_note_window(&app, &id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_board(app: AppHandle) -> Result<(), String> {
    open_board_window(&app).map_err(|e| e.to_string())
}

/// Pin a note to the desktop: keep it on every workspace and out of the
/// taskbar/dock switcher, so it behaves like a sticky stuck to the desktop.
#[tauri::command]
fn set_pinned(app: AppHandle, label: String, pinned: bool) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(&label) {
        w.set_visible_on_all_workspaces(pinned)
            .map_err(|e| e.to_string())?;
        w.set_skip_taskbar(pinned).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_always_on_top_cmd(app: AppHandle, label: String, value: bool) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(&label) {
        w.set_always_on_top(value).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Google OAuth loopback ─────────────────────────────────────────────────────
//
// We run our own minimal loopback server instead of relying on a plugin that
// delivers the code via a second browser-side fetch + window.emit — that path
// was unreliable on Windows (the success page's window.close() raced/aborted
// the follow-up fetch, so the code never reached the app). Here we read the
// authorization code straight from the FIRST redirect request line and
// broadcast it with a global app.emit, which works the same on every platform.

const OAUTH_REDIRECT_EVENT: &str = "msticky://oauth-redirect";

const OAUTH_SUCCESS_HTML: &str = r#"<!doctype html><html><head><meta charset="utf-8"><title>Msticky</title>
<style>body{font-family:-apple-system,Segoe UI,system-ui,sans-serif;background:#fef9c3;color:#3f3a16;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
.card{background:#fff;padding:2rem 2.5rem;border-radius:1rem;box-shadow:0 10px 30px rgba(0,0,0,.1)}
h1{margin:0 0 .25rem;font-size:1.25rem}p{margin:0;opacity:.6;font-size:.9rem}</style></head>
<body><div class="card"><h1>&#10003; Đã đăng nhập Msticky</h1><p>Bạn có thể đóng tab này và quay lại ứng dụng.</p></div></body></html>"#;

/// Bind an ephemeral loopback port and return it. A background thread serves the
/// single OAuth redirect: it writes a success page back to the browser and emits
/// the request's path+query (which carries `code` and `state`) to the frontend.
#[tauri::command]
async fn oauth_bind(app: AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    std::thread::spawn(move || {
        for conn in listener.incoming() {
            let mut stream = match conn {
                Ok(s) => s,
                Err(_) => continue,
            };
            let mut buf = [0u8; 8192];
            let n = stream.read(&mut buf).unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]);
            // First request line, e.g. "GET /?code=...&state=... HTTP/1.1".
            let path = req
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .unwrap_or("")
                .to_string();

            let body = OAUTH_SUCCESS_HTML;
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(resp.as_bytes());
            let _ = stream.flush();

            // Ignore favicon / preflight probes that carry no code.
            if path.contains("code=") || path.contains("error=") {
                let _ = app.emit(OAUTH_REDIRECT_EVENT, path);
                break;
            }
        }
    });

    Ok(port)
}

// ── OS keychain (caches the E2E key per device) ──────────────────────────────

const KEYCHAIN_SERVICE: &str = "com.msticky.app";

// Keychain access can block (the OS may show a permission prompt), so run it on
// a blocking thread — never the main thread, or the whole UI freezes.

#[tauri::command]
async fn keychain_set(account: String, value: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let e = keyring::Entry::new(KEYCHAIN_SERVICE, &account).map_err(|e| e.to_string())?;
        e.set_password(&value).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn keychain_get(account: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let e = keyring::Entry::new(KEYCHAIN_SERVICE, &account).map_err(|e| e.to_string())?;
        match e.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn keychain_delete(account: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let e = keyring::Entry::new(KEYCHAIN_SERVICE, &account).map_err(|e| e.to_string())?;
        match e.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── App bootstrap ────────────────────────────────────────────────────────────

fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create notes table",
        sql: "CREATE TABLE IF NOT EXISTS notes (
                id            TEXT PRIMARY KEY,
                content       TEXT NOT NULL DEFAULT '',
                color         TEXT NOT NULL DEFAULT 'yellow',
                pos_x         REAL NOT NULL DEFAULT 80,
                pos_y         REAL NOT NULL DEFAULT 80,
                width         REAL NOT NULL DEFAULT 280,
                height        REAL NOT NULL DEFAULT 280,
                pinned        INTEGER NOT NULL DEFAULT 0,
                always_on_top INTEGER NOT NULL DEFAULT 0,
                archived      INTEGER NOT NULL DEFAULT 0,
                deleted       INTEGER NOT NULL DEFAULT 0,
                updated_at    INTEGER NOT NULL DEFAULT 0
              );
              CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);",
        kind: MigrationKind::Up,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // single-instance MUST be the first plugin; a second launch focuses the board.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            spawn_open_board(app);
        }));
    }

    builder
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations("sqlite:msticky.db", migrations())
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(build_global_shortcut())
        .setup(|app| {
            let handle = app.handle().clone();

            // Register the quick-note global hotkey.
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                let _ = app.global_shortcut().register(quick_note_shortcut());
            }

            // System tray.
            #[cfg(desktop)]
            build_tray(&handle)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_note_window,
            open_board,
            set_pinned,
            set_always_on_top_cmd,
            oauth_bind,
            keychain_set,
            keychain_get,
            keychain_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running Msticky");
}

// ── Global shortcut (Cmd/Ctrl+Shift+N) ───────────────────────────────────────

#[cfg(desktop)]
fn quick_note_shortcut() -> tauri_plugin_global_shortcut::Shortcut {
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
    // Cmd on macOS, Ctrl elsewhere.
    #[cfg(target_os = "macos")]
    let primary = Modifiers::SUPER;
    #[cfg(not(target_os = "macos"))]
    let primary = Modifiers::CONTROL;
    Shortcut::new(Some(primary | Modifiers::SHIFT), Code::KeyN)
}

fn build_global_shortcut() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::ShortcutState;
        let target = quick_note_shortcut();
        return tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if event.state() == ShortcutState::Pressed && shortcut == &target {
                    new_note_window(app);
                }
            })
            .build();
    }
    #[cfg(not(desktop))]
    {
        tauri_plugin_global_shortcut::Builder::new().build()
    }
}

// ── Tray ─────────────────────────────────────────────────────────────────────

#[cfg(desktop)]
fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::TrayIconBuilder;

    let new_i = MenuItem::with_id(app, "new", "New note", true, Some("CmdOrCtrl+Shift+N"))?;
    let board_i = MenuItem::with_id(app, "board", "Open board", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit Msticky", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&new_i, &board_i, &sep, &quit_i])?;

    TrayIconBuilder::with_id("msticky-tray")
        .tooltip("Msticky")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "new" => new_note_window(app),
            "board" => spawn_open_board(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}
