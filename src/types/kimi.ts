import type {
  CodebuddyUsage,
  OfficialQuotaResource,
  QuotaCategory,
  QuotaCategoryGroup,
} from "./codebuddy-suite";
import { normalizeTimestamp } from "../utils/dataExtract";

export interface KimiUsageRow {
  name?: string | null;
  windowUnit?: string | null;
  windowDuration?: number | null;
  used: number;
  limit: number;
  resetAt?: string | null;
}

export interface KimiQuota {
  weeklyUsed?: number | null;
  weeklyLimit?: number | null;
  weeklyResetAt?: string | null;
  limits?: KimiUsageRow[];
  boosterBalanceCents?: number | null;
  boosterTotalCents?: number | null;
  boosterCurrency?: string | null;
  userLevelName?: string | null;
  region?: string | null;
}

/** Sanitized account DTO; credentials never cross IPC. */
export interface KimiAccount {
  id: string;
  email: string;
  access_token: string;
  tags?: string[] | null;
  nickname?: string | null;
  user_id?: string | null;
  avatar?: string | null;
  expires_at?: number | null;
  plan_type?: string;
  quota?: KimiQuota | null;
  status?: string | null;
  status_reason?: string | null;
  quota_query_last_error?: string | null;
  quota_query_last_error_at?: number | null;
  usage_updated_at?: number | null;
  created_at: number;
  last_used: number;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function quotaClass(remainPercent: number | null): string {
  if (remainPercent == null) return "high";
  if (remainPercent <= 10) return "critical";
  if (remainPercent <= 30) return "low";
  if (remainPercent <= 60) return "medium";
  return "high";
}

function amountResource(
  code: string,
  name: string,
  usedValue: number,
  totalValue: number,
  refreshAt: number | null,
): OfficialQuotaResource {
  const total = Math.max(0, totalValue);
  const used = Math.max(0, usedValue);
  const remain = Math.max(0, total - used);
  const usedPercent = total > 0 ? clampPercent((used / total) * 100) : 0;
  const remainPercent = total > 0 ? clampPercent((remain / total) * 100) : null;
  return {
    packageCode: code,
    packageName: name,
    cycleStartTime: null,
    cycleEndTime: null,
    deductionEndTime: null,
    expiredTime: null,
    total,
    remain,
    used,
    usedPercent,
    remainPercent,
    refreshAt,
    expireAt: null,
    isBasePackage: false,
  };
}

function group(
  category: QuotaCategory,
  label: string,
  items: OfficialQuotaResource[],
): QuotaCategoryGroup {
  const total = items.reduce((sum, item) => sum + item.total, 0);
  const used = items.reduce((sum, item) => sum + item.used, 0);
  const remain = items.reduce((sum, item) => sum + item.remain, 0);
  const usedPercent = total > 0 ? clampPercent((used / total) * 100) : 0;
  const remainPercent = total > 0 ? clampPercent((remain / total) * 100) : null;
  return {
    key: category,
    label,
    used,
    total,
    remain,
    usedPercent,
    remainPercent,
    quotaClass: quotaClass(remainPercent),
    items,
    visible: items.length > 0,
  };
}

export function getKimiAccountDisplayEmail(account: KimiAccount): string {
  const nickname = account.nickname?.trim();
  if (nickname) return nickname;
  const email = account.email?.trim();
  if (email && !email.endsWith("@kimi.local")) return email;
  if (email) return email;
  return account.user_id?.trim() || account.id;
}

export function getKimiPlanBadge(account: KimiAccount): string {
  return (
    account.quota?.userLevelName?.trim() ||
    account.plan_type?.trim() ||
    "Kimi Code"
  );
}

export function hasKimiQuotaData(account: KimiAccount): boolean {
  const q = account.quota;
  if (!q) return false;
  return (
    finite(q.weeklyLimit) != null ||
    (Array.isArray(q.limits) && q.limits.length > 0)
  );
}

export function getKimiQuotaGroups(account: KimiAccount): QuotaCategoryGroup[] {
  const q = account.quota;
  if (!q) return [];
  const groups: QuotaCategoryGroup[] = [];
  const weeklyUsed = finite(q.weeklyUsed) ?? 0;
  const weeklyLimit = finite(q.weeklyLimit);
  const weeklyReset = q.weeklyResetAt
    ? normalizeTimestamp(q.weeklyResetAt)
    : null;
  const weeklyResetMs = weeklyReset == null ? null : weeklyReset * 1000;

  if (weeklyLimit != null && weeklyLimit > 0) {
    groups.push(
      group("base", "Weekly", [
        amountResource(
          "kimi-weekly",
          "Weekly",
          weeklyUsed,
          weeklyLimit,
          weeklyResetMs,
        ),
      ]),
    );
  }

  const limitItems: OfficialQuotaResource[] = [];
  for (const [index, row] of (q.limits || []).entries()) {
    const limit = finite(row.limit);
    if (limit == null || limit <= 0) continue;
    const used = finite(row.used) ?? 0;
    const reset = row.resetAt ? normalizeTimestamp(row.resetAt) : null;
    const label =
      row.name?.trim() ||
      (row.windowUnit
        ? `${row.windowDuration ?? ""} ${row.windowUnit}`.trim()
        : `Limit ${index + 1}`);
    limitItems.push(
      amountResource(
        `kimi-limit-${index}`,
        label,
        used,
        limit,
        reset == null ? null : reset * 1000,
      ),
    );
  }
  if (limitItems.length > 0) {
    groups.push(group("extra", "Windows", limitItems));
  }
  return groups.filter((g) => g.visible);
}

export interface KimiQuotaSummaryItem {
  key: string;
  label: string;
  percentage: number;
  resetAtMs: number | null;
  used?: number | null;
  total?: number | null;
}

export function getKimiQuotaSummaryItems(
  account: KimiAccount,
): KimiQuotaSummaryItem[] {
  return getKimiQuotaGroups(account).flatMap((g) =>
    g.items.map((item) => ({
      key: item.packageCode || g.key,
      label: item.packageName || g.label,
      percentage: item.usedPercent,
      resetAtMs: item.refreshAt,
      used: item.used,
      total: item.total,
    })),
  );
}

export function getKimiQuotaClass(usedPercent: number): string {
  return quotaClass(100 - usedPercent);
}

export function formatKimiQuotaUsedTotal(
  used?: number | null,
  total?: number | null,
): string | null {
  const u = finite(used);
  const t = finite(total);
  if (u == null || t == null) return null;
  return `${Math.round(u)} / ${Math.round(t)}`;
}

export function getKimiUsage(account: KimiAccount): CodebuddyUsage {
  const groups = getKimiQuotaGroups(account);
  const primary = groups[0]?.items[0];
  const usedPercent = primary?.usedPercent ?? null;
  return {
    isNormal: account.status !== "reauth_required",
    inlineSuggestionsUsedPercent: usedPercent,
    chatMessagesUsedPercent: usedPercent,
    allowanceResetAt: primary?.refreshAt ?? null,
  };
}
