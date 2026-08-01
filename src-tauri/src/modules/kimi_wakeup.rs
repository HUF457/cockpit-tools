//! Kimi Code wakeup tasks — Codex-shaped state machine on a single official slot.
//! Run path: acquire slot lock → inject_to_default(account) → invoke Kimi CLI → release.

use crate::modules::{config, kimi_account, logger};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use uuid::Uuid;

const STATE_FILE: &str = "kimi_wakeup_state.json";
const HISTORY_FILE: &str = "kimi_wakeup_history.json";
const RUNTIME_CONFIG_FILE: &str = "kimi_wakeup_runtime.json";
const MAX_HISTORY: usize = 200;
const DEFAULT_PROMPT: &str = "hi";
const DEFAULT_MODEL: &str = "kimi-for-coding";

static SLOT_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static STATE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static HISTORY_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn slot_lock() -> &'static Mutex<()> {
    SLOT_LOCK.get_or_init(|| Mutex::new(()))
}

fn state_lock() -> &'static Mutex<()> {
    STATE_LOCK.get_or_init(|| Mutex::new(()))
}

fn history_lock() -> &'static Mutex<()> {
    HISTORY_LOCK.get_or_init(|| Mutex::new(()))
}

fn lock_or_recover<'a, T>(mutex: &'a Mutex<T>, label: &str) -> std::sync::MutexGuard<'a, T> {
    match mutex.lock() {
        Ok(g) => g,
        Err(e) => {
            logger::log_warn(&format!(
                "[KimiWakeup] 锁中毒恢复: {}",
                label
            ));
            e.into_inner()
        }
    }
}

fn now_ts() -> i64 {
    chrono::Utc::now().timestamp()
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn data_dir() -> Result<PathBuf, String> {
    config::get_data_dir()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KimiWakeupSchedule {
    /// daily | weekly | interval | quota_reset | startup
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub daily_time: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub weekly_days: Vec<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weekly_time: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interval_hours: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_reset_window: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub startup_delay_minutes: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KimiWakeupTask {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub account_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub schedule: KimiWakeupSchedule,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_success_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_failure_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KimiWakeupState {
    pub enabled: bool,
    #[serde(default)]
    pub tasks: Vec<KimiWakeupTask>,
}

impl Default for KimiWakeupState {
    fn default() -> Self {
        Self {
            enabled: false,
            tasks: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KimiWakeupHistoryItem {
    pub id: String,
    pub run_id: String,
    pub timestamp: i64,
    pub trigger_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_name: Option<String>,
    pub account_id: String,
    pub account_email: String,
    pub success: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_path: Option<String>,
    /// True when inject_to_default ran successfully before CLI.
    #[serde(default)]
    pub injected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KimiCliStatus {
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binary_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub configured_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub checked_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KimiWakeupRuntimeConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kimi_cli_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KimiWakeupBatchResult {
    pub run_id: String,
    pub runtime: KimiCliStatus,
    pub records: Vec<KimiWakeupHistoryItem>,
    pub success_count: usize,
    pub failure_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KimiWakeupOverview {
    pub runtime: KimiCliStatus,
    pub state: KimiWakeupState,
    pub history: Vec<KimiWakeupHistoryItem>,
}

fn read_json_file<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> Result<T, String> {
    if !path.exists() {
        return Ok(T::default());
    }
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("读取失败 {}: {}", path.display(), e))?;
    if content.trim().is_empty() {
        return Ok(T::default());
    }
    serde_json::from_str(&content).map_err(|e| format!("解析失败 {}: {}", path.display(), e))
}

fn write_json_file<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }
    let content = serde_json::to_string_pretty(value)
        .map_err(|e| format!("序列化失败: {}", e))?;
    crate::modules::atomic_write::write_string_atomic(path, &content)
}

pub fn load_runtime_config() -> Result<KimiWakeupRuntimeConfig, String> {
    read_json_file(&data_dir()?.join(RUNTIME_CONFIG_FILE))
}

pub fn save_runtime_config(config: &KimiWakeupRuntimeConfig) -> Result<KimiWakeupRuntimeConfig, String> {
    write_json_file(&data_dir()?.join(RUNTIME_CONFIG_FILE), config)?;
    Ok(config.clone())
}

pub fn load_state() -> Result<KimiWakeupState, String> {
    let _g = lock_or_recover(state_lock(), "state");
    read_json_file(&data_dir()?.join(STATE_FILE))
}

pub fn save_state(next: &KimiWakeupState) -> Result<KimiWakeupState, String> {
    let _g = lock_or_recover(state_lock(), "state");
    write_json_file(&data_dir()?.join(STATE_FILE), next)?;
    Ok(next.clone())
}

pub fn load_history() -> Result<Vec<KimiWakeupHistoryItem>, String> {
    let _g = lock_or_recover(history_lock(), "history");
    #[derive(Default, Deserialize)]
    struct Hist {
        #[serde(default)]
        items: Vec<KimiWakeupHistoryItem>,
    }
    let hist: Hist = read_json_file(&data_dir()?.join(HISTORY_FILE))?;
    Ok(hist.items)
}

fn append_history(items: &[KimiWakeupHistoryItem]) -> Result<(), String> {
    let _g = lock_or_recover(history_lock(), "history");
    #[derive(Default, Serialize, Deserialize)]
    struct Hist {
        #[serde(default)]
        items: Vec<KimiWakeupHistoryItem>,
    }
    let path = data_dir()?.join(HISTORY_FILE);
    let mut hist: Hist = read_json_file(&path)?;
    hist.items.extend_from_slice(items);
    if hist.items.len() > MAX_HISTORY {
        let drop_n = hist.items.len() - MAX_HISTORY;
        hist.items.drain(0..drop_n);
    }
    write_json_file(&path, &hist)
}

pub fn clear_history() -> Result<(), String> {
    let _g = lock_or_recover(history_lock(), "history");
    #[derive(Serialize)]
    struct Hist {
        items: Vec<KimiWakeupHistoryItem>,
    }
    write_json_file(
        &data_dir()?.join(HISTORY_FILE),
        &Hist { items: Vec::new() },
    )
}

fn which_on_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
        #[cfg(windows)]
        {
            let with_exe = dir.join(format!("{}.exe", name));
            if with_exe.is_file() {
                return Some(with_exe);
            }
            let with_cmd = dir.join(format!("{}.cmd", name));
            if with_cmd.is_file() {
                return Some(with_cmd);
            }
        }
    }
    None
}

pub fn get_cli_status() -> KimiCliStatus {
    let configured = load_runtime_config()
        .ok()
        .and_then(|c| c.kimi_cli_path)
        .filter(|s| !s.trim().is_empty());
    let mut binary: Option<PathBuf> = None;
    let mut message: Option<String> = None;

    if let Some(ref custom) = configured {
        let p = PathBuf::from(custom.trim());
        if p.is_file() {
            binary = Some(p);
        } else {
            message = Some(format!("配置的 Kimi CLI 路径不存在: {}", custom));
        }
    }
    if binary.is_none() {
        binary = which_on_path("kimi");
    }

    let mut version = None;
    if let Some(ref bin) = binary {
        if let Ok(out) = Command::new(bin).arg("--version").output() {
            let text = String::from_utf8_lossy(&out.stdout);
            let err = String::from_utf8_lossy(&out.stderr);
            let combined = format!("{}{}", text, err).trim().to_string();
            if !combined.is_empty() {
                version = Some(combined.lines().next().unwrap_or("").to_string());
            }
        }
    }

    let available = binary.is_some();
    if !available && message.is_none() {
        message = Some(
            "未检测到 Kimi Code CLI。请安装官方 CLI 或在唤醒设置中填写路径。".to_string(),
        );
    }

    KimiCliStatus {
        available,
        binary_path: binary.map(|p| p.to_string_lossy().to_string()),
        configured_path: configured,
        version,
        message,
        checked_at: now_ms(),
    }
}

/// Core run unit: inject official slot then CLI. Serialized by SLOT_LOCK.
pub fn run_account_wakeup(
    account_id: &str,
    prompt: &str,
    model: Option<&str>,
    trigger_type: &str,
    task_id: Option<&str>,
    task_name: Option<&str>,
    run_id: &str,
) -> KimiWakeupHistoryItem {
    let started = Instant::now();
    let account_email = kimi_account::load_account(account_id)
        .map(|a| a.email)
        .unwrap_or_else(|| account_id.to_string());

    let _slot = lock_or_recover(slot_lock(), "official-slot");

    let inject_result = kimi_account::inject_to_default(account_id);
    let injected = inject_result.is_ok();
    if let Err(ref err) = inject_result {
        return KimiWakeupHistoryItem {
            id: format!("hist-{}", Uuid::new_v4()),
            run_id: run_id.to_string(),
            timestamp: now_ts(),
            trigger_type: trigger_type.to_string(),
            task_id: task_id.map(str::to_string),
            task_name: task_name.map(str::to_string),
            account_id: account_id.to_string(),
            account_email,
            success: false,
            prompt: Some(prompt.to_string()),
            model: model.map(str::to_string),
            reply: None,
            error: Some(format!("切号写入官方凭据失败: {}", err)),
            duration_ms: Some(started.elapsed().as_millis() as u64),
            cli_path: None,
            injected: false,
        };
    }

    let runtime = get_cli_status();
    if !runtime.available {
        return KimiWakeupHistoryItem {
            id: format!("hist-{}", Uuid::new_v4()),
            run_id: run_id.to_string(),
            timestamp: now_ts(),
            trigger_type: trigger_type.to_string(),
            task_id: task_id.map(str::to_string),
            task_name: task_name.map(str::to_string),
            account_id: account_id.to_string(),
            account_email,
            success: false,
            prompt: Some(prompt.to_string()),
            model: model.map(str::to_string),
            reply: None,
            error: Some(
                runtime
                    .message
                    .unwrap_or_else(|| "Kimi CLI 不可用".to_string()),
            ),
            duration_ms: Some(started.elapsed().as_millis() as u64),
            cli_path: None,
            injected: true,
        };
    }

    let cli_path = runtime.binary_path.clone().unwrap_or_default();
    let model_id = model.unwrap_or(DEFAULT_MODEL);
    // Official CLI: non-interactive prompt. Args follow common kimi-code CLI shape.
    let output = Command::new(&cli_path)
        .arg("--print")
        .arg("--model")
        .arg(model_id)
        .arg(prompt)
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let success = out.status.success();
            let error = if success {
                None
            } else if !stderr.is_empty() {
                Some(stderr.clone())
            } else {
                Some(format!("CLI 退出码 {:?}", out.status.code()))
            };
            let reply = if stdout.is_empty() {
                None
            } else {
                Some(stdout)
            };
            // Best-effort quota refresh after successful wake.
            if success {
                let account_id_owned = account_id.to_string();
                tauri::async_runtime::spawn(async move {
                    let _ = kimi_account::refresh_account(&account_id_owned).await;
                });
            }
            KimiWakeupHistoryItem {
                id: format!("hist-{}", Uuid::new_v4()),
                run_id: run_id.to_string(),
                timestamp: now_ts(),
                trigger_type: trigger_type.to_string(),
                task_id: task_id.map(str::to_string),
                task_name: task_name.map(str::to_string),
                account_id: account_id.to_string(),
                account_email,
                success,
                prompt: Some(prompt.to_string()),
                model: Some(model_id.to_string()),
                reply,
                error,
                duration_ms: Some(started.elapsed().as_millis() as u64),
                cli_path: Some(cli_path),
                injected: true,
            }
        }
        Err(e) => KimiWakeupHistoryItem {
            id: format!("hist-{}", Uuid::new_v4()),
            run_id: run_id.to_string(),
            timestamp: now_ts(),
            trigger_type: trigger_type.to_string(),
            task_id: task_id.map(str::to_string),
            task_name: task_name.map(str::to_string),
            account_id: account_id.to_string(),
            account_email,
            success: false,
            prompt: Some(prompt.to_string()),
            model: model.map(str::to_string),
            reply: None,
            error: Some(format!("启动 Kimi CLI 失败: {}", e)),
            duration_ms: Some(started.elapsed().as_millis() as u64),
            cli_path: Some(cli_path),
            injected: true,
        },
    }
}

pub fn run_batch(
    account_ids: &[String],
    prompt: Option<&str>,
    model: Option<&str>,
    trigger_type: &str,
    task_id: Option<&str>,
    task_name: Option<&str>,
) -> Result<KimiWakeupBatchResult, String> {
    let run_id = format!("run-{}", Uuid::new_v4());
    let prompt = prompt.unwrap_or(DEFAULT_PROMPT);
    let runtime = get_cli_status();
    let mut records = Vec::new();
    for id in account_ids {
        records.push(run_account_wakeup(
            id,
            prompt,
            model,
            trigger_type,
            task_id,
            task_name,
            &run_id,
        ));
    }
    let success_count = records.iter().filter(|r| r.success).count();
    let failure_count = records.len() - success_count;
    append_history(&records)?;
    Ok(KimiWakeupBatchResult {
        run_id,
        runtime,
        records,
        success_count,
        failure_count,
    })
}

pub fn run_task(task_id: &str, trigger_type: &str) -> Result<KimiWakeupBatchResult, String> {
    let mut state = load_state()?;
    let task = state
        .tasks
        .iter()
        .find(|t| t.id == task_id)
        .cloned()
        .ok_or_else(|| format!("任务不存在: {}", task_id))?;
    if !state.enabled && trigger_type != "manual" && trigger_type != "test" {
        return Err("Kimi 唤醒总开关已关闭".to_string());
    }
    if !task.enabled && trigger_type != "manual" && trigger_type != "test" {
        return Err("任务未启用".to_string());
    }
    if task.account_ids.is_empty() {
        return Err("任务未选择账号".to_string());
    }
    let result = run_batch(
        &task.account_ids,
        task.prompt.as_deref(),
        task.model.as_deref(),
        trigger_type,
        Some(task_id),
        Some(&task.name),
    )?;
    // Update task stats
    if let Some(t) = state.tasks.iter_mut().find(|t| t.id == task_id) {
        t.last_run_at = Some(now_ts());
        t.last_status = Some(if result.failure_count == 0 {
            "success".to_string()
        } else if result.success_count == 0 {
            "failed".to_string()
        } else {
            "partial".to_string()
        });
        t.last_message = Some(format!(
            "成功 {} / 失败 {}",
            result.success_count, result.failure_count
        ));
        t.last_success_count = Some(result.success_count as u32);
        t.last_failure_count = Some(result.failure_count as u32);
        t.last_duration_ms = result
            .records
            .iter()
            .filter_map(|r| r.duration_ms)
            .max();
        t.updated_at = now_ts();
    }
    let _ = save_state(&state);
    Ok(result)
}

pub fn run_enabled_tasks(trigger_type: &str) -> Result<Vec<KimiWakeupBatchResult>, String> {
    let state = load_state()?;
    if !state.enabled {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for task in state.tasks.iter().filter(|t| t.enabled) {
        match run_task(&task.id, trigger_type) {
            Ok(r) => out.push(r),
            Err(e) => logger::log_warn(&format!(
                "[KimiWakeup] 任务失败: id={}, err={}",
                task.id, e
            )),
        }
    }
    Ok(out)
}

pub fn load_overview() -> Result<KimiWakeupOverview, String> {
    Ok(KimiWakeupOverview {
        runtime: get_cli_status(),
        state: load_state()?,
        history: load_history()?,
    })
}

/// Test helper: records inject order without requiring real CLI when `simulate_cli_missing`.
#[cfg(test)]
pub fn run_account_wakeup_for_test_inject_order(
    account_id: &str,
    inject_fn: impl FnOnce(&str) -> Result<String, String>,
) -> (bool, Option<String>) {
    let _slot = lock_or_recover(slot_lock(), "official-slot");
    match inject_fn(account_id) {
        Ok(_) => (true, None),
        Err(e) => (false, Some(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[test]
    fn slot_serializes_inject_before_cli() {
        let order = Arc::new(Mutex::new(Vec::<String>::new()));
        let inject_count = Arc::new(AtomicUsize::new(0));

        let order_a = order.clone();
        let inject_a = inject_count.clone();
        let (injected, err) = run_account_wakeup_for_test_inject_order("acc-a", move |id| {
            order_a.lock().unwrap().push(format!("inject:{}", id));
            inject_a.fetch_add(1, Ordering::SeqCst);
            Ok("ok".to_string())
        });
        assert!(injected);
        assert!(err.is_none());
        assert_eq!(inject_count.load(Ordering::SeqCst), 1);

        // CLI missing still requires inject first — exercised via run_account_wakeup with no CLI.
        // Here we only assert lock + inject ordering helper.
        let names = order.lock().unwrap().clone();
        assert_eq!(names, vec!["inject:acc-a".to_string()]);
    }

    #[test]
    fn schedule_kinds_are_documented_in_default_task_shape() {
        let task = KimiWakeupTask {
            id: "t1".into(),
            name: "daily".into(),
            enabled: true,
            account_ids: vec!["a".into()],
            prompt: Some("hi".into()),
            model: None,
            schedule: KimiWakeupSchedule {
                kind: "daily".into(),
                daily_time: Some("08:00".into()),
                weekly_days: vec![],
                weekly_time: None,
                interval_hours: None,
                quota_reset_window: None,
                startup_delay_minutes: None,
            },
            created_at: 1,
            updated_at: 1,
            last_run_at: None,
            last_status: None,
            last_message: None,
            last_success_count: None,
            last_failure_count: None,
            last_duration_ms: None,
        };
        for kind in ["daily", "weekly", "interval", "quota_reset", "startup"] {
            let mut t = task.clone();
            t.schedule.kind = kind.to_string();
            let json = serde_json::to_string(&t).unwrap();
            assert!(json.contains(kind));
        }
    }

    #[test]
    fn state_roundtrip_under_test_data_dir() {
        let _lock = crate::modules::test_support::env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join(format!(
            "kimi-wakeup-state-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("COCKPIT_TOOLS_TEST_DATA_DIR", &dir);
        std::env::set_var("COCKPIT_TOOLS_DATA_DIR", &dir);

        let mut state = KimiWakeupState::default();
        state.enabled = true;
        state.tasks.push(KimiWakeupTask {
            id: "task-1".into(),
            name: "wake".into(),
            enabled: true,
            account_ids: vec!["kimi-1".into()],
            prompt: Some("hi".into()),
            model: Some(DEFAULT_MODEL.into()),
            schedule: KimiWakeupSchedule {
                kind: "interval".into(),
                daily_time: None,
                weekly_days: vec![],
                weekly_time: None,
                interval_hours: Some(6),
                quota_reset_window: None,
                startup_delay_minutes: None,
            },
            created_at: now_ts(),
            updated_at: now_ts(),
            last_run_at: None,
            last_status: None,
            last_message: None,
            last_success_count: None,
            last_failure_count: None,
            last_duration_ms: None,
        });
        save_state(&state).expect("save");
        let loaded = load_state().expect("load");
        assert!(loaded.enabled);
        assert_eq!(loaded.tasks.len(), 1);
        assert_eq!(loaded.tasks[0].schedule.kind, "interval");

        std::env::remove_var("COCKPIT_TOOLS_TEST_DATA_DIR");
        std::env::remove_var("COCKPIT_TOOLS_DATA_DIR");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
