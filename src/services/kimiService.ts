import { invoke } from '@tauri-apps/api/core';
import type { KimiAccount } from '../types/kimi';

export interface KimiOAuthLoginStartResponse {
  loginId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string | null;
  expiresIn: number;
  intervalSeconds: number;
}

export async function listKimiAccounts(): Promise<KimiAccount[]> {
  return await invoke('list_kimi_accounts');
}

export async function deleteKimiAccount(accountId: string): Promise<void> {
  await invoke('delete_kimi_account', { accountId });
}

export async function deleteKimiAccounts(accountIds: string[]): Promise<void> {
  await invoke('delete_kimi_accounts', { accountIds });
}

export async function importKimiFromJson(
  jsonContent: string,
): Promise<KimiAccount[]> {
  return await invoke('import_kimi_from_json', { jsonContent });
}

export async function importKimiFromLocal(): Promise<KimiAccount[]> {
  return await invoke('import_kimi_from_local');
}

export async function exportKimiAccounts(
  accountIds: string[],
): Promise<string> {
  return await invoke('export_kimi_accounts', { accountIds });
}

export async function startKimiOAuthLogin(): Promise<KimiOAuthLoginStartResponse> {
  return await invoke('kimi_oauth_login_start');
}

export async function completeKimiOAuthLogin(
  loginId: string,
  reauthAccountId?: string | null,
): Promise<KimiAccount> {
  return await invoke('kimi_oauth_login_complete', {
    loginId,
    reauthAccountId: reauthAccountId ?? null,
  });
}

export async function cancelKimiOAuthLogin(loginId?: string): Promise<void> {
  await invoke('kimi_oauth_login_cancel', { loginId: loginId ?? null });
}

export async function refreshKimiAccount(
  accountId: string,
): Promise<KimiAccount> {
  return await invoke('refresh_kimi_account', { accountId });
}

export async function refreshAllKimiAccounts(): Promise<number> {
  return await invoke('refresh_all_kimi_accounts');
}

export async function switchKimiAccount(accountId: string): Promise<string> {
  return await invoke('switch_kimi_account', { accountId });
}

export async function updateKimiAccountTags(
  accountId: string,
  tags: string[],
): Promise<KimiAccount> {
  return await invoke('update_kimi_account_tags', { accountId, tags });
}

export async function getKimiCurrentAccountId(): Promise<string | null> {
  return await invoke('get_kimi_current_account_id');
}

export async function getKimiAccountsIndexPath(): Promise<string> {
  return await invoke('get_kimi_accounts_index_path');
}
