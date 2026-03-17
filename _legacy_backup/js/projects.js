// ════════════════════════════════════════════════════════════
//  PROJECTS — Storage helpers
//  Global scope so RealEstatePlatform can reference them.
// ════════════════════════════════════════════════════════════

const STORAGE_KEY = 'refm_v2';

const loadStorage = () => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    return { projects: {}, lastActiveProjectId: null, lastActiveVersionId: null };
};

const saveStorage = (store) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch(e) {}
};

const genId = (prefix) => prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
