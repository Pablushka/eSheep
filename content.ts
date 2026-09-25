import { ESheep } from './DesktopPet';

const ANIMATION_URL = chrome.runtime.getURL('animation.xml');

declare const chrome: {
  runtime: {
    getURL(path: string): string;
  };
  storage: {
    local: {
      get(keys: { enabled: boolean }): Promise<{ enabled?: boolean }>;
    };
    onChanged: {
      addListener(callback: (changes: { enabled?: { newValue?: boolean } }) => void): void;
    };
  };
};

let sheep: ESheep | null = null;

async function syncSheep(enabled: boolean): Promise<void> {
  if (enabled && !sheep) {
    sheep = new ESheep();
    await sheep.Start(ANIMATION_URL);
    return;
  }

  if (!enabled && sheep) {
    sheep.Destroy();
    sheep = null;
  }
}

void chrome.storage.local.get({ enabled: true }).then(({ enabled = true }) => {
  return syncSheep(enabled);
}).catch((error: unknown) => {
  console.error('eSheep could not read its enabled state:', error);
});

chrome.storage.onChanged.addListener((changes) => {
  const enabled = changes.enabled?.newValue;
  if (enabled !== undefined) void syncSheep(enabled);
});



