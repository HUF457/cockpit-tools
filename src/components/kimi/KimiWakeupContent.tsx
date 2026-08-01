import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CircleAlert,
  Play,
  Plus,
  Power,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import * as kimiWakeupService from '../../services/kimiWakeupService';
import { useKimiWakeupStore } from '../../stores/useKimiWakeupStore';
import type { KimiAccount } from '../../types/kimi';
import { getKimiAccountDisplayEmail } from '../../types/kimi';
import {
  createEmptyKimiWakeupTask,
  DEFAULT_KIMI_WAKEUP_MODEL,
  DEFAULT_KIMI_WAKEUP_PROMPT,
  type KimiWakeupScheduleKind,
  type KimiWakeupTask,
} from '../../types/kimiWakeup';

interface KimiWakeupContentProps {
  accounts: KimiAccount[];
  onRefreshAccounts: () => Promise<void>;
}

const SCHEDULE_KINDS: { value: KimiWakeupScheduleKind; label: string }[] = [
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'interval', label: '间隔' },
  { value: 'quota_reset', label: '额度重置' },
  { value: 'startup', label: '启动时' },
];

export function KimiWakeupContent({
  accounts,
  onRefreshAccounts,
}: KimiWakeupContentProps) {
  const { t } = useTranslation();
  const {
    state,
    history,
    runtime,
    loading,
    error,
    fetchOverview,
    setEnabled,
    upsertTask,
    deleteTask,
    toggleTask,
    clearHistory,
  } = useKimiWakeupStore();

  const [editor, setEditor] = useState<KimiWakeupTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [cliPath, setCliPath] = useState('');

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  useEffect(() => {
    if (runtime?.configured_path) setCliPath(runtime.configured_path);
  }, [runtime?.configured_path]);

  const accountOptions = useMemo(
    () =>
      accounts.map((a) => ({
        id: a.id,
        label: getKimiAccountDisplayEmail(a),
      })),
    [accounts],
  );

  const openNew = () => {
    setEditor(
      createEmptyKimiWakeupTask({
        account_ids: accounts[0] ? [accounts[0].id] : [],
      }),
    );
    setMessage(null);
  };

  const saveEditor = async () => {
    if (!editor) return;
    if (!editor.name.trim()) {
      setMessage(t('kimi.wakeup.nameRequired', '请填写任务名称'));
      return;
    }
    if (editor.account_ids.length === 0) {
      setMessage(t('kimi.wakeup.accountsRequired', '请至少选择一个账号'));
      return;
    }
    setBusy(true);
    try {
      await upsertTask({
        ...editor,
        updated_at: Math.floor(Date.now() / 1000),
      });
      setEditor(null);
      setMessage(t('kimi.wakeup.saved', '任务已保存'));
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  const runTask = async (taskId: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await kimiWakeupService.runKimiWakeupTask(taskId);
      setMessage(
        t('kimi.wakeup.runDone', '完成：成功 {{ok}} / 失败 {{fail}}', {
          ok: result.success_count,
          fail: result.failure_count,
        }),
      );
      await fetchOverview();
      await onRefreshAccounts();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  const runTestSelected = async () => {
    if (!editor || editor.account_ids.length === 0) {
      setMessage(t('kimi.wakeup.accountsRequired', '请至少选择一个账号'));
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await kimiWakeupService.testKimiWakeup(
        editor.account_ids,
        editor.prompt || DEFAULT_KIMI_WAKEUP_PROMPT,
        editor.model || DEFAULT_KIMI_WAKEUP_MODEL,
      );
      setMessage(
        t('kimi.wakeup.testDone', '测试完成：成功 {{ok}} / 失败 {{fail}}', {
          ok: result.success_count,
          fail: result.failure_count,
        }),
      );
      await fetchOverview();
      await onRefreshAccounts();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveCliPath = useCallback(async () => {
    setBusy(true);
    try {
      await kimiWakeupService.updateKimiWakeupRuntimeConfig({
        kimi_cli_path: cliPath.trim() || null,
      });
      await fetchOverview();
      setMessage(t('kimi.wakeup.cliPathSaved', 'CLI 路径已保存'));
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }, [cliPath, fetchOverview, t]);

  const toggleAccount = (accountId: string) => {
    if (!editor) return;
    const set = new Set(editor.account_ids);
    if (set.has(accountId)) set.delete(accountId);
    else set.add(accountId);
    setEditor({ ...editor, account_ids: Array.from(set) });
  };

  return (
    <div className="kimi-wakeup-page" style={{ padding: '12px 16px' }}>
      <div
        className="settings-group"
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div className="settings-row" style={{ alignItems: 'center' }}>
          <div className="row-label">
            <div className="row-title">
              {t('kimi.wakeup.masterSwitch', '唤醒总开关')}
            </div>
            <div className="row-desc">
              {t(
                'kimi.wakeup.masterSwitchDesc',
                '关闭后定时/额度重置/启动任务不会执行；手动测试仍可用。',
              )}
            </div>
          </div>
          <div className="row-control">
            <label className="switch">
              <input
                type="checkbox"
                checked={state.enabled}
                onChange={(e) => void setEnabled(e.target.checked)}
              />
              <span className="slider" />
            </label>
          </div>
        </div>

        <div className="settings-row">
          <div className="row-label">
            <div className="row-title">
              {t('kimi.wakeup.cliPath', 'Kimi CLI 路径')}
            </div>
            <div className="row-desc">
              {runtime?.available
                ? t('kimi.wakeup.cliOk', '已检测 {{path}}', {
                    path: runtime.binary_path || runtime.version || '--',
                  })
                : runtime?.message ||
                  t('kimi.wakeup.cliMissing', '未检测到 kimi CLI')}
            </div>
          </div>
          <div className="row-control" style={{ display: 'flex', gap: 8 }}>
            <input
              className="settings-input settings-input--path"
              value={cliPath}
              placeholder="kimi"
              onChange={(e) => setCliPath(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => void saveCliPath()}
            >
              {t('common.save', '保存')}
            </button>
            <button
              type="button"
              className="btn btn-secondary icon-only"
              title={t('common.refresh', '刷新')}
              onClick={() => void fetchOverview()}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {(error || message) && (
          <div
            className={`add-status ${error ? 'error' : 'success'}`}
            style={{ display: 'flex', gap: 8, alignItems: 'center' }}
          >
            {error ? <CircleAlert size={14} /> : null}
            <span>{error || message}</span>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div className="group-title" style={{ margin: 0 }}>
            {t('kimi.wakeup.tasks', '任务列表')}
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={openNew}
            disabled={busy || loading}
          >
            <Plus size={14} />
            {t('kimi.wakeup.addTask', '新建任务')}
          </button>
        </div>

        {state.tasks.length === 0 ? (
          <div className="quota-empty">
            {t('kimi.wakeup.noTasks', '暂无唤醒任务')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {state.tasks.map((task) => (
              <div
                key={task.id}
                className="codex-account-card"
                style={{ padding: 12 }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <strong>{task.name}</strong>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {task.schedule.kind}
                      {' · '}
                      {task.account_ids.length}{' '}
                      {t('kimi.wakeup.accountsUnit', '账号')}
                      {task.last_status
                        ? ` · ${task.last_status}${task.last_message ? ` (${task.last_message})` : ''}`
                        : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={task.enabled}
                        onChange={(e) =>
                          void toggleTask(task.id, e.target.checked)
                        }
                      />
                      <span className="slider" />
                    </label>
                    <button
                      type="button"
                      className="btn btn-secondary icon-only"
                      title={t('kimi.wakeup.run', '立即执行')}
                      disabled={busy}
                      onClick={() => void runTask(task.id)}
                    >
                      <Play size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={busy}
                      onClick={() => setEditor({ ...task })}
                    >
                      {t('common.edit', '编辑')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary icon-only"
                      title={t('common.delete', '删除')}
                      disabled={busy}
                      onClick={() => void deleteTask(task.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 8,
          }}
        >
          <div className="group-title" style={{ margin: 0 }}>
            {t('kimi.wakeup.history', '运行历史')}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || history.length === 0}
            onClick={() => void clearHistory()}
          >
            {t('kimi.wakeup.clearHistory', '清空历史')}
          </button>
        </div>
        {history.length === 0 ? (
          <div className="quota-empty">
            {t('kimi.wakeup.noHistory', '暂无历史')}
          </div>
        ) : (
          <div style={{ maxHeight: 240, overflow: 'auto', fontSize: 12 }}>
            {history
              .slice()
              .reverse()
              .slice(0, 50)
              .map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: '6px 0',
                    borderBottom: '1px solid var(--border-subtle, #233)',
                  }}
                >
                  <span style={{ color: item.success ? 'var(--success)' : 'var(--danger)' }}>
                    {item.success ? 'OK' : 'FAIL'}
                  </span>
                  {' · '}
                  {item.account_email}
                  {' · '}
                  {item.trigger_type}
                  {item.injected === false ? ' · no-inject' : ''}
                  {item.error ? ` · ${item.error}` : ''}
                  {item.reply ? ` · ${item.reply.slice(0, 80)}` : ''}
                </div>
              ))}
          </div>
        )}
      </div>

      {editor && (
        <div className="modal-overlay">
          <div
            className="modal modal-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>
                {editor.created_at === editor.updated_at &&
                !state.tasks.some((t) => t.id === editor.id)
                  ? t('kimi.wakeup.addTask', '新建任务')
                  : t('kimi.wakeup.editTask', '编辑任务')}
              </h2>
              <button
                className="modal-close"
                onClick={() => setEditor(null)}
                aria-label={t('common.close', '关闭')}
              >
                <X />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="form-group">
                <label>{t('kimi.wakeup.taskName', '名称')}</label>
                <input
                  className="form-input"
                  value={editor.name}
                  onChange={(e) =>
                    setEditor({ ...editor, name: e.target.value })
                  }
                />
              </div>
              <div className="form-group">
                <label>{t('kimi.wakeup.prompt', 'Prompt')}</label>
                <input
                  className="form-input"
                  value={editor.prompt || ''}
                  onChange={(e) =>
                    setEditor({ ...editor, prompt: e.target.value })
                  }
                />
              </div>
              <div className="form-group">
                <label>{t('kimi.wakeup.model', '模型')}</label>
                <input
                  className="form-input"
                  value={editor.model || DEFAULT_KIMI_WAKEUP_MODEL}
                  onChange={(e) =>
                    setEditor({ ...editor, model: e.target.value })
                  }
                />
              </div>
              <div className="form-group">
                <label>{t('kimi.wakeup.scheduleKind', '触发方式')}</label>
                <select
                  className="form-input"
                  value={editor.schedule.kind}
                  onChange={(e) =>
                    setEditor({
                      ...editor,
                      schedule: {
                        ...editor.schedule,
                        kind: e.target.value as KimiWakeupScheduleKind,
                      },
                    })
                  }
                >
                  {SCHEDULE_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
              {editor.schedule.kind === 'daily' && (
                <div className="form-group">
                  <label>{t('kimi.wakeup.dailyTime', '每天时间')}</label>
                  <input
                    className="form-input"
                    type="time"
                    value={editor.schedule.daily_time || '08:00'}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        schedule: {
                          ...editor.schedule,
                          daily_time: e.target.value,
                        },
                      })
                    }
                  />
                </div>
              )}
              {editor.schedule.kind === 'interval' && (
                <div className="form-group">
                  <label>{t('kimi.wakeup.intervalHours', '间隔（小时）')}</label>
                  <input
                    className="form-input"
                    type="number"
                    min={1}
                    value={editor.schedule.interval_hours ?? 6}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        schedule: {
                          ...editor.schedule,
                          interval_hours: Number(e.target.value) || 1,
                        },
                      })
                    }
                  />
                </div>
              )}
              {editor.schedule.kind === 'quota_reset' && (
                <div className="form-group">
                  <label>
                    {t('kimi.wakeup.quotaWindow', '额度窗口')}
                  </label>
                  <select
                    className="form-input"
                    value={editor.schedule.quota_reset_window || 'either'}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        schedule: {
                          ...editor.schedule,
                          quota_reset_window: e.target.value as
                            | 'either'
                            | 'primary_window'
                            | 'secondary_window',
                        },
                      })
                    }
                  >
                    <option value="either">Weekly 或 Windows</option>
                    <option value="primary_window">Weekly</option>
                    <option value="secondary_window">Windows</option>
                  </select>
                </div>
              )}
              <div className="form-group">
                <label>{t('kimi.wakeup.selectAccounts', '账号')}</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {accountOptions.map((opt) => (
                    <label
                      key={opt.id}
                      style={{
                        display: 'inline-flex',
                        gap: 4,
                        alignItems: 'center',
                        fontSize: 13,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={editor.account_ids.includes(opt.id)}
                        onChange={() => toggleAccount(opt.id)}
                      />
                      {opt.label}
                    </label>
                  ))}
                  {accountOptions.length === 0 && (
                    <span className="quota-empty">
                      {t('kimi.empty', '暂无 Kimi Code 账号')}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void runTestSelected()}
              >
                <Power size={14} />
                {t('kimi.wakeup.test', '测试运行')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditor(null)}
              >
                {t('common.cancel', '取消')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void saveEditor()}
              >
                {t('common.save', '保存')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
