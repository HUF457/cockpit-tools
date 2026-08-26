import { coalescedInvoke } from '../utils/invokeCache';
import type { AntigravityRuntimeTarget } from '../utils/antigravityRuntimeTarget';

// A full scan walks the filesystem and costs ~2.5s when Antigravity is absent.
// The install cannot change while the app is open, so both the boot-time
// resolver and the version badge should share one answer.
const INSTALLED_VERSION_TTL_MS = 60_000;

export interface AntigravityInstalledVersionInfo {
  product_name: string;
  version: string;
  app_path: string;
  source: string;
}

export type AntigravityInstalledVersionScanMode = 'quick' | 'full';

export async function getAntigravityInstalledVersionInfo(
  target?: AntigravityRuntimeTarget,
  scanMode: AntigravityInstalledVersionScanMode = 'quick',
): Promise<AntigravityInstalledVersionInfo | null> {
  return coalescedInvoke<AntigravityInstalledVersionInfo | null>(
    'get_antigravity_installed_version_info',
    { target, scanMode },
    { ttlMs: INSTALLED_VERSION_TTL_MS },
  );
}

function getAlternateAntigravityRuntimeTarget(
  target: AntigravityRuntimeTarget,
): AntigravityRuntimeTarget {
  return target === 'antigravity_ide' ? 'antigravity' : 'antigravity_ide';
}

async function detectTargetVersion(
  target: AntigravityRuntimeTarget,
  scanMode: AntigravityInstalledVersionScanMode,
): Promise<boolean> {
  try {
    const info = await getAntigravityInstalledVersionInfo(target, scanMode);
    return !!info?.version;
  } catch (error) {
    console.warn(
      `[AntigravityRuntime] failed to detect ${target} ${scanMode} version:`,
      error,
    );
    return false;
  }
}

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
};

function whenIdle(timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve) => {
    const ric = (window as IdleWindow).requestIdleCallback;
    if (typeof ric === 'function') {
      ric(() => resolve(), { timeout: timeoutMs });
      return;
    }
    window.setTimeout(resolve, Math.min(timeoutMs, 3_000));
  });
}

export async function resolvePreferredAntigravityRuntimeTarget(
  currentTarget: AntigravityRuntimeTarget,
): Promise<AntigravityRuntimeTarget> {
  const alternateTarget = getAlternateAntigravityRuntimeTarget(currentTarget);

  const [currentQuickAvailable, alternateQuickAvailable] = await Promise.all([
    detectTargetVersion(currentTarget, 'quick'),
    detectTargetVersion(alternateTarget, 'quick'),
  ]);
  if (currentQuickAvailable) {
    return currentTarget;
  }
  if (alternateQuickAvailable) {
    return alternateTarget;
  }

  // Neither quick scan found an install. The full scan walks the filesystem for
  // seconds per target, and when nothing is installed it cannot change the
  // answer below - so keep it out of the startup window, where it otherwise
  // competes with account loading and the update check for CPU. Running the
  // targets in sequence also stops two scans from pinning two cores at once.
  await whenIdle();

  if (await detectTargetVersion(currentTarget, 'full')) {
    return currentTarget;
  }
  if (await detectTargetVersion(alternateTarget, 'full')) {
    return alternateTarget;
  }
  return currentTarget;
}
