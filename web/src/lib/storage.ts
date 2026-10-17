// Only ids are kept between reloads; everything else is fetched again.

const KEY_DATASET = 'leakdesk.dataset_id';
const KEY_ANALYSIS = 'leakdesk.analysis_id';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage may be blocked (private window); the app works without it.
  }
}

export const storage = {
  datasetId: () => read(KEY_DATASET),
  analysisId: () => read(KEY_ANALYSIS),
  save(datasetId: string | null, analysisId: string | null) {
    write(KEY_DATASET, datasetId);
    write(KEY_ANALYSIS, analysisId);
  },
  clear() {
    write(KEY_DATASET, null);
    write(KEY_ANALYSIS, null);
  },
};
