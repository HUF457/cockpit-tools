//! Background tick for Kimi wakeup tasks (Codex scheduler shape, thinner).

use crate::modules::{kimi_account, kimi_wakeup, logger};
use chrono::{DateTime, Datelike, Local, TimeZone};
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::AppHandle;
use tokio::time::sleep;

static STARTED: OnceLock<Mutex<bool>> = OnceLock::new();
static RUNNING: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static STARTUP_DONE: OnceLock<Mutex<bool>> = OnceLock::new();

fn started_flag() -> &'static Mutex<bool> {
    STARTED.get_or_init(|| Mutex::new(false))
}

fn running_tasks() -> &'static Mutex<HashSet<String>> {
    RUNNING.get_or_init(|| Mutex::new(HashSet::new()))
}

fn startup_flag() -> &'static Mutex<bool> {
    STARTUP_DONE.get_or_init(|| Mutex::new(false))
}

fn lock_or_recover<'a, T>(mutex: &'a Mutex<T>) -> std::sync::MutexGuard<'a, T> {
    match mutex.lock() {
        Ok(g) => g,
        Err(e) => e.into_inner(),
    }
}

fn parse_time_to_minutes(value: &str) -> Option<i32> {
    let parts: Vec<&str> = value.trim().split(':').collect();
    if parts.len() != 2 {
        return None;
    }
    let hour: i32 = parts[0].parse().ok()?;
    let minute: i32 = parts[1].parse().ok()?;
    if !(0..=23).contains(&hour) || !(0..=59).contains(&minute) {
        return None;
    }
    Some(hour * 60 + minute)
}

fn build_local_datetime(date: chrono::NaiveDate, minutes: i32) -> Option<DateTime<Local>> {
    let hour = (minutes / 60) as u32;
    let minute = (minutes % 60) as u32;
    Local
        .with_ymd_and_hms(date.year(), date.month(), date.day(), hour, minute, 0)
        .earliest()
        .or_else(|| {
            Local
                .with_ymd_and_hms(date.year(), date.month(), date.day(), hour, minute, 0)
                .latest()
        })
}

fn collect_quota_reset_ts(task: &kimi_wakeup::KimiWakeupTask) -> Vec<i64> {
    let window = task
        .schedule
        .quota_reset_window
        .as_deref()
        .unwrap_or("either");
    let include_primary = window == "either" || window == "primary_window";
    let include_secondary = window == "either" || window == "secondary_window";
    let selected: HashSet<&str> = task.account_ids.iter().map(String::as_str).collect();
    let mut ts = Vec::new();
    if let Ok(views) = kimi_account::list_accounts_checked() {
        for view in views {
            if !selected.contains(view.id.as_str()) {
                continue;
            }
            if let Some(account) = kimi_account::load_account(&view.id) {
                if let Some(quota) = account.quota {
                    if include_primary {
                        if let Some(reset) = quota.weekly_reset_at.as_deref() {
                            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(reset) {
                                ts.push(dt.timestamp());
                            } else if let Ok(n) = reset.parse::<i64>() {
                                ts.push(if n > 1_000_000_000_000 { n / 1000 } else { n });
                            }
                        }
                    }
                    if include_secondary {
                        for row in quota.limits {
                            if let Some(reset) = row.reset_at.as_deref() {
                                if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(reset) {
                                    ts.push(dt.timestamp());
                                } else if let Ok(n) = reset.parse::<i64>() {
                                    ts.push(if n > 1_000_000_000_000 { n / 1000 } else { n });
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    ts.sort_unstable();
    ts.dedup();
    ts
}

fn current_due_at(task: &kimi_wakeup::KimiWakeupTask, now: DateTime<Local>) -> Option<i64> {
    match task.schedule.kind.as_str() {
        "daily" => {
            let minutes = parse_time_to_minutes(task.schedule.daily_time.as_deref()?)?;
            let candidate = build_local_datetime(now.date_naive(), minutes)?.timestamp();
            if candidate <= now.timestamp() && task.last_run_at.unwrap_or(0) < candidate {
                Some(candidate)
            } else {
                None
            }
        }
        "weekly" => {
            let minutes = parse_time_to_minutes(task.schedule.weekly_time.as_deref()?)?;
            let weekday = now.weekday().num_days_from_sunday() as i32;
            if !task.schedule.weekly_days.contains(&weekday) {
                return None;
            }
            let candidate = build_local_datetime(now.date_naive(), minutes)?.timestamp();
            if candidate <= now.timestamp() && task.last_run_at.unwrap_or(0) < candidate {
                Some(candidate)
            } else {
                None
            }
        }
        "interval" => {
            let hours = task.schedule.interval_hours.unwrap_or(0);
            if hours <= 0 {
                return None;
            }
            let last = task.last_run_at.unwrap_or(0);
            let due = last + (hours as i64) * 3600;
            if last == 0 || due <= now.timestamp() {
                Some(now.timestamp())
            } else {
                None
            }
        }
        "quota_reset" => {
            let last = task.last_run_at.unwrap_or(0);
            collect_quota_reset_ts(task)
                .into_iter()
                .find(|ts| *ts <= now.timestamp() && *ts > last)
        }
        "startup" => None, // handled once via trigger_startup_tasks_if_needed
        _ => None,
    }
}

pub fn ensure_started(app: AppHandle) {
    let mut started = lock_or_recover(started_flag());
    if *started {
        return;
    }
    *started = true;
    drop(started);
    tauri::async_runtime::spawn(async move {
        loop {
            sleep(Duration::from_secs(30)).await;
            if let Err(e) = tick_once().await {
                logger::log_warn(&format!("[KimiWakeupScheduler] tick 失败: {}", e));
            }
            let _ = &app; // keep handle alive for future event emit
        }
    });
}

pub fn trigger_startup_tasks_if_needed(_app: AppHandle) {
    let mut done = lock_or_recover(startup_flag());
    if *done {
        return;
    }
    *done = true;
    drop(done);
    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_secs(15)).await;
        let state = match kimi_wakeup::load_state() {
            Ok(s) => s,
            Err(_) => return,
        };
        if !state.enabled {
            return;
        }
        for task in state.tasks.iter().filter(|t| t.enabled && t.schedule.kind == "startup") {
            let delay = task.schedule.startup_delay_minutes.unwrap_or(0).max(0) as u64;
            if delay > 0 {
                sleep(Duration::from_secs(delay * 60)).await;
            }
            let mut running = lock_or_recover(running_tasks());
            if !running.insert(task.id.clone()) {
                continue;
            }
            drop(running);
            let id = task.id.clone();
            let result = kimi_wakeup::run_task(&id, "startup");
            lock_or_recover(running_tasks()).remove(&id);
            if let Err(e) = result {
                logger::log_warn(&format!(
                    "[KimiWakeupScheduler] startup 任务失败: {} {}",
                    id, e
                ));
            }
        }
    });
}

async fn tick_once() -> Result<(), String> {
    let state = kimi_wakeup::load_state()?;
    if !state.enabled {
        return Ok(());
    }
    let now = Local::now();
    for task in state.tasks.iter().filter(|t| t.enabled) {
        if task.schedule.kind == "startup" {
            continue;
        }
        if current_due_at(task, now).is_none() {
            continue;
        }
        {
            let mut running = lock_or_recover(running_tasks());
            if !running.insert(task.id.clone()) {
                continue;
            }
        }
        let id = task.id.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            kimi_wakeup::run_task(&id, "scheduled")
        })
        .await;
        lock_or_recover(running_tasks()).remove(&task.id);
        match result {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => logger::log_warn(&format!(
                "[KimiWakeupScheduler] 任务失败 {}: {}",
                task.id, e
            )),
            Err(e) => logger::log_warn(&format!(
                "[KimiWakeupScheduler] join 失败 {}: {}",
                task.id, e
            )),
        }
    }
    Ok(())
}
