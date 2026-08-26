import { coalescedInvoke } from '../utils/invokeCache';
import type { AntigravityRuntimeTarget } from '../utils/antigravityRuntimeTarget';

// A full scan walks the filesystem and costs ~2.5s when Antigravity is absent.
// A found install stays put while the app is open, so the boot-time resolver
// and the version badge can share one positive answer. A miss is not stable -
// the user may install Antigravity with Cockpit running - so only hits are
// held for the TTL; concurrent scans still share the in-flight promise.
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
    { ttlMs: INSTALLED_VERSION_TTL_MS, cacheValue: (info) => info !== null },
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

// The renderer goes idle long before the backend does, so an idle callback on
// its own still lands inside the startup window. Hold for a fixed delay first,
// by which point account loading and the update check have drained.
const FULL_SCAN_BOOT_DELAY_MS = 10_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

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
  await delay(FULL_SCAN_BOOT_DELAY_MS);
  await whenIdle();

  if (await detectTargetVersion(currentTarget, 'full')) {
    return currentTarget;
  }
  if (await detectTargetVersion(alternateTarget, 'full')) {
    return alternateTarget;
  }
  return currentTarget;
}
