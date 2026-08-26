import { create } from 'zustand';
import type { SponsorModuleState } from '../types/sponsor';
import { forceRefreshSponsorModuleState, getSponsorModuleState } from '../services/sponsorService';
import { PROMO_SURFACES_ENABLED } from '../config/forkFeatures';

const EMPTY_STATE: SponsorModuleState = {
  sponsorModule: null,
};

interface SponsorStoreState {
  state: SponsorModuleState;
  loading: boolean;
  initialized: boolean;
  fetchState: (force?: boolean) => Promise<SponsorModuleState>;
}

export const useSponsorStore = create<SponsorStoreState>((set) => ({
  state: EMPTY_STATE,
  loading: false,
  initialized: !PROMO_SURFACES_ENABLED,

  fetchState: async (force = false) => {
    if (!PROMO_SURFACES_ENABLED) {
      set({ state: EMPTY_STATE, loading: false, initialized: true });
      return EMPTY_STATE;
    }
    set({ loading: true });
    try {
      const nextState = force
        ? await forceRefreshSponsorModuleState()
        : await getSponsorModuleState();
      set({ state: nextState, loading: false, initialized: true });
      return nextState;
    } catch (error) {
      console.error('加载赞助商模块失败:', error);
      set({ state: EMPTY_STATE, loading: false, initialized: true });
      return EMPTY_STATE;
    }
  },
}));
