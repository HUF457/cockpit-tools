import { invoke } from '@tauri-apps/api/core';
import type {
  KimiCliStatus,
  KimiWakeupBatchResult,
  KimiWakeupHistoryItem,
  KimiWakeupOverview,
  KimiWakeupRuntimeConfig,
  KimiWakeupState,
} from '../types/kimiWakeup';

export async function getKimiWakeupCliStatus(): Promise<KimiCliStatus> {
  return invoke('kimi_wakeup_get_cli_status');
}

export async function updateKimiWakeupRuntimeConfig(
  config: KimiWakeupRuntimeConfig,
): Promise<KimiWakeupRuntimeConfig> {
  return invoke('kimi_wakeup_update_runtime_config', { config });
}

export async function getKimiWakeupOverview(): Promise<KimiWakeupOverview> {
  return invoke('kimi_wakeup_get_overview');
}

export async function getKimiWakeupState(): Promise<KimiWakeupState> {
  return invoke('kimi_wakeup_get_state');
}

export async function saveKimiWakeupState(
  state: KimiWakeupState,
): Promise<KimiWakeupState> {
  return invoke('kimi_wakeup_save_state', { state });
}

export async function loadKimiWakeupHistory(): Promise<KimiWakeupHistoryItem[]> {
  return invoke('kimi_wakeup_load_history');
}

export async function clearKimiWakeupHistory(): Promise<void> {
  return invoke('kimi_wakeup_clear_history');
}

export async function testKimiWakeup(
  accountIds: string[],
  prompt?: string,
  model?: string,
): Promise<KimiWakeupBatchResult> {
  return invoke('kimi_wakeup_test', {
    accountIds,
    prompt: prompt ?? null,
    model: model ?? null,
  });
}

export async function runKimiWakeupTask(
  taskId: string,
): Promise<KimiWakeupBatchResult> {
  return invoke('kimi_wakeup_run_task', { taskId });
}

export async function runEnabledKimiWakeupTasks(): Promise<
  KimiWakeupBatchResult[]
> {
  return invoke('kimi_wakeup_run_enabled_tasks');
}
