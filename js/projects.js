// ════════════════════════════════════════════════════════════
//  PROJECTS — Financial Modeler Pro / REFM Platform
//  Project & version storage helpers: key, load/save,
//  and ID generator. These are module-scoped utilities
//  used by refm-platform.js (RealEstatePlatform component).
//
//  Storage schema (localStorage key: STORAGE_KEY):
//  {
//    projects: {
//      [projectId]: {
//        name:       string,
//        location:   string,
//        assetMix:   string[],
//        status:     string,
//        createdAt:  ISO string,
//        versions: {
//          [versionId]: {
//            name:      string,
//            createdAt: ISO string,
//            data:      snapshot object
//          }
//        }
//      }
//    },
//    lastActiveProjectId: string | null,
//    lastActiveVersionId: string | null
//  }
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
