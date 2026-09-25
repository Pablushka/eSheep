declare const chrome: {
  storage: {
    local: {
      get(keys: { enabled: boolean }): Promise<{ enabled?: boolean }>;
      set(items: { enabled: boolean }): Promise<void>;
    };
  };
  tabs: {
    query(queryInfo: { active: boolean; currentWindow: boolean }): Promise<{ id?: number }[]>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
  };
};

const toggle = document.getElementById('toggle') as HTMLButtonElement;
const petStatus = document.getElementById('status') as HTMLParagraphElement;

function render(enabled: boolean): void {
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.textContent = enabled ? 'Sheep are roaming' : 'Let a sheep roam';
    petStatus.textContent = enabled
        ? 'Your browsing companion is on.'
        : 'The sheep is taking a break.';
}

async function init(): Promise<void> {
    const { enabled = true } = await chrome.storage.local.get({ enabled: true });
    render(enabled);
}

toggle.addEventListener('click', async () => {
    const { enabled = true } = await chrome.storage.local.get({ enabled: true });
    const next = !enabled;
    await chrome.storage.local.set({ enabled: next });
    render(next);
});

// Ask the active tab's content script to play a specific animation.
async function playAnimation(name: string): Promise<void> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (tabId === undefined) return;

    try {
        await chrome.tabs.sendMessage(tabId, { type: 'play-animation', name });
    } catch {
        // No content script in this tab (e.g. a chrome:// page) — ignore.
    }
}

document.querySelectorAll<HTMLButtonElement>('[data-animation]').forEach((button) => {
    button.addEventListener('click', () => {
        const name = button.dataset.animation;
        if (name) void playAnimation(name);
    });
});

void init().catch((error: unknown) => {
    console.error('eSheep popup could not read its state:', error);
});


