use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
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

fn new_note_window(app: &AppHandle) {
    let id = uuid::Uuid::new_v4().to_string();
    let _ = create_note_window(app, &id);
}

// ── Commands invoked from JS ────────────────────────────────────────────────

#[tauri::command]
fn open_note_window(app: AppHandle, id: String) -> Result<(), String> {
    create_note_window(&app, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_board(app: AppHandle) -> Result<(), String> {
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
            let _ = open_board_window(app);
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
            "board" => {
                let _ = open_board_window(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}
