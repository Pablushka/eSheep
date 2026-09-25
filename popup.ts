declare const chrome: {
  storage: {
    local: {
      get(keys: { enabled: boolean }): Promise<{ enabled?: boolean }>;
      set(items: { enabled: boolean }): Promise<void>;
    };
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

void init().catch((error: unknown) => {
    console.error('eSheep popup could not read its state:', error);
});


