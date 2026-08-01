import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CodebuddySuiteAccountsSharedView,
  type CodebuddySuiteAccountsPlatformConfig,
} from "../components/codebuddy-suite/CodebuddySuiteAccountsSharedView";
import {
  PlatformOverviewTabsHeader,
  type PlatformOverviewTab,
} from "../components/platform/PlatformOverviewTabsHeader";
import { useProviderAccountsPage } from "../hooks/useProviderAccountsPage";
import * as kimiService from "../services/kimiService";
import { useKimiAccountStore } from "../stores/useKimiAccountStore";
import {
  getKimiAccountDisplayEmail,
  getKimiPlanBadge,
  getKimiQuotaGroups,
  getKimiUsage,
  hasKimiQuotaData,
  type KimiAccount,
} from "../types/kimi";

const FLOW_NOTICE_KEY = "agtools.kimi.flow_notice_collapsed";
const CURRENT_ACCOUNT_KEY = "agtools.kimi.current_account_id";

function getKimiReauthorizationReason(account: KimiAccount): string | null {
  const reason = account.status_reason?.trim() || "";
  const normalized = `${account.status || ""} ${reason}`.toLowerCase();
  if (
    account.status === "reauth_required" ||
    normalized.includes("invalid_grant") ||
    normalized.includes("refresh") ||
    normalized.includes("unauthorized") ||
    normalized.includes("access_denied")
  ) {
    return reason || "reauth_required";
  }
  return null;
}

export function KimiAccountsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<PlatformOverviewTab>("overview");
  const store = useKimiAccountStore();
  const [reauthTargetAccount, setReauthTargetAccount] =
    useState<KimiAccount | null>(null);

  const page = useProviderAccountsPage<KimiAccount>({
    platformKey: "kimi",
    oauthLogPrefix: "KimiOAuth",
    flowNoticeCollapsedKey: FLOW_NOTICE_KEY,
    currentAccountIdKey: CURRENT_ACCOUNT_KEY,
    exportFilePrefix: "kimi_accounts",
    oauthTabKeys: ["oauth"],
    store: {
      accounts: store.accounts,
      currentAccountId: store.currentAccountId,
      loading: store.loading,
      error: store.error,
      fetchAccounts: store.fetchAccounts,
      fetchCurrentAccountId: store.fetchCurrentAccountId,
      deleteAccounts: store.deleteAccounts,
      refreshToken: store.refreshToken,
      refreshAllTokens: store.refreshAllTokens,
      setCurrentAccountId: store.setCurrentAccountId,
      updateAccountTags: store.updateAccountTags,
    },
    oauthService: {
      startLogin: kimiService.startKimiOAuthLogin,
      completeLogin: (loginId) =>
        kimiService.completeKimiOAuthLogin(
          loginId,
          reauthTargetAccount?.id ?? null,
        ),
      cancelLogin: kimiService.cancelKimiOAuthLogin,
    },
    dataService: {
      importFromJson: kimiService.importKimiFromJson,
      importFromLocal: kimiService.importKimiFromLocal,
      exportAccounts: kimiService.exportKimiAccounts,
      injectToVSCode: kimiService.switchKimiAccount,
    },
    getDisplayEmail: getKimiAccountDisplayEmail,
    onInjectSuccess: async () => {
      await store.fetchAccounts();
      await store.fetchCurrentAccountId();
    },
    resolveOauthSuccessMessage: () =>
      t("kimi.oauth.success", "Kimi Code OAuth 登录成功"),
  });

  useEffect(() => {
    if (!page.showAddModal) {
      setReauthTargetAccount(null);
    }
  }, [page.showAddModal]);

  const handleReauthorize = useCallback(
    (account: KimiAccount) => {
      setReauthTargetAccount(account);
      page.openAddModal("oauth");
    },
    [page.openAddModal],
  );

  const platformConfig: CodebuddySuiteAccountsPlatformConfig<KimiAccount> = {
    pageClassName: "kimi-accounts-page",
    searchPlaceholderKey: "kimi.search",
    searchPlaceholderDefault: "搜索 Kimi Code 账号...",
    flowNotice: {
      titleKey: "kimi.flowNotice.title",
      titleDefault: "Kimi Code 账号管理说明",
      descKey: "kimi.flowNotice.desc",
      descDefault:
        "多账号索引保存在 Cockpit；切号会写入官方 ~/.kimi-code/credentials/kimi-code.json，并确保 config.toml 中有 managed:kimi-code。",
      permissionKey: "kimi.flowNotice.permission",
      permissionDefault:
        "本地范围：可读取默认 ~/.kimi-code 凭据用于导入；切号时写入官方 credentials 与 config.toml。",
      networkKey: "kimi.flowNotice.network",
      networkDefault:
        "网络范围：OAuth 授权、token 刷新与 /me · /usages 额度查询；不会把凭据上传到 Cockpit 服务。",
    },
    noAccountsKey: "kimi.empty",
    noAccountsDefault: "暂无 Kimi Code 账号",
    addAccountTitleKey: "kimi.addAccount",
    addAccountTitleDefault: "添加 Kimi Code 账号",
    oauthDescKey: "kimi.oauth.desc",
    oauthDescDefault:
      "打开 Kimi 授权页（系统默认浏览器）完成设备码登录，完成后账号会自动保存。",
    oauthFeatureCardClassName: "kimi-oauth-feature-card",
    oauthFeatureTitleKey: "kimi.oauth.title",
    oauthFeatureTitleDefault: "Kimi Code Device OAuth",
    oauthFeatureItem1Key: "kimi.oauth.item1",
    oauthFeatureItem1Default:
      "使用官方 device flow，浏览器授权，不占用本地回调端口。",
    oauthFeatureItem2Key: "kimi.oauth.item2",
    oauthFeatureItem2Default:
      "切号写入 ~/.kimi-code/credentials/kimi-code.json（官方 wire 格式）。",
    oauthFeatureItem3Key: "kimi.oauth.item3",
    oauthFeatureItem3Default:
      "额度来自官方 /usages；登录仅拉 /me 资料，尽量少占请求。",
    oauthUrlInputPlaceholderKey: "kimi.oauth.urlPlaceholder",
    oauthUrlInputPlaceholderDefault: "Kimi OAuth 授权地址",
    oauthWaitingKey: "kimi.oauth.waiting",
    oauthWaitingDefault: "等待 Kimi OAuth 授权...",
    oauthOpenButtonKey: "kimi.oauth.openWindow",
    oauthOpenButtonDefault: "打开授权页",
    tokenDescKey: "kimi.import.tokenDesc",
    tokenDescDefault:
      "也可粘贴官方 credentials/kimi-code.json，或本应用导出的完整账号 JSON。",
    showPasteJsonTab: true,
    pasteJsonTabLabelKey: "common.shared.addModal.token",
    pasteJsonTabLabelDefault: "Token / JSON",
    pasteJsonDescKey: "kimi.import.pasteDesc",
    pasteJsonDescDefault:
      "粘贴官方 credentials/kimi-code.json，或本应用导出的完整账号 JSON。",
    pasteJsonPlaceholderKey: "kimi.import.pastePlaceholder",
    pasteJsonPlaceholderDefault: "粘贴 Kimi Code 账号 JSON",
    pasteJsonSubmitLabelKey: "kimi.import.pasteAction",
    pasteJsonSubmitLabelDefault: "导入 JSON",
    importLocalDescKey: "kimi.import.localDesc",
    importLocalDescDefault:
      "从默认 ~/.kimi-code/credentials/kimi-code.json 导入（尊重 KIMI_CODE_HOME）。",
    importLocalClientKey: "kimi.import.localClient",
    importLocalClientDefault: "从本机 Kimi Code CLI 导入",
    getDisplayEmail: getKimiAccountDisplayEmail,
    getPlanBadge: (account) =>
      getKimiPlanBadge(account) || t("common.none", "暂无"),
    getPlanBadgeTitle: (account) =>
      getKimiPlanBadge(account) || t("common.none", "暂无"),
    getPlanBadgeClass: () => "pro",
    getSearchText: (account) =>
      [
        getKimiAccountDisplayEmail(account),
        account.user_id,
        account.nickname,
        account.email,
        getKimiPlanBadge(account),
      ]
        .filter(Boolean)
        .join(" "),
    getUsage: getKimiUsage,
    getQuotaGroups: (account) => getKimiQuotaGroups(account),
    hasQuotaData: (account) => hasKimiQuotaData(account),
    usagePrefix: "kimi",
    quotaPrefix: "kimi",
    tableUsageClassName: "kimi-table-usage",
    showMfaQuickCode: false,
    getReauthorizationReason: getKimiReauthorizationReason,
    reauthorizingAccount: reauthTargetAccount,
    onReauthorize: handleReauthorize,
  };

  return (
    <div className="ghcp-accounts-page kimi-accounts-page">
      <PlatformOverviewTabsHeader
        platform="kimi"
        active={activeTab}
        onTabChange={setActiveTab}
      />
      <CodebuddySuiteAccountsSharedView
        accounts={store.accounts}
        loading={store.loading}
        page={page}
        platformConfig={platformConfig}
        onRefreshAccounts={() => void store.fetchAccounts()}
      />
    </div>
  );
}
