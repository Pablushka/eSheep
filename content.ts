import { ESheep } from './DesktopPet';

const ANIMATION_URL = chrome.runtime.getURL('animation.xml');

declare const pepe: {
  someProperty: string;
}

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

void syncSheep(true).catch((error: unknown) => {
  console.error('eSheep could not start on this page:', error);
});

void chrome.storage.local.get({ enabled: true }).then(({ enabled = true }) => {
  return syncSheep(enabled);
}).catch((error: unknown) => {
  console.error('eSheep could not read its enabled state:', error);
});

chrome.storage.onChanged.addListener((changes) => {
  const enabled = changes.enabled?.newValue;
  if (enabled !== undefined) void syncSheep(enabled);
});

/// End of content script for eSheep

function renderReadingTime(article: any) {
  // If we weren't provided an article, we don't need to render anything.
  if (!article) {
    console.log('No article provided');
    return;
  }

  const text = article.textContent;
  console.log(text);

  const wordMatchRegExp = /[^\s]+/g; // Regular expression
  const words = text.matchAll(wordMatchRegExp);
  // matchAll returns an iterator, convert to array to get word count
  const wordCount = [...words].length;
  const readingTime = Math.round(wordCount / 1);
  const badge = document.createElement("p");
  // Use the same styling as the publish information in an article's header
  badge.classList.add("color-secondary-text", "type--caption");
  badge.textContent = `⏱️ ${readingTime} min read`;

  // Support for API reference docs
  const heading = article.querySelector("h1");
  heading?.insertAdjacentElement("afterend", badge);
  console.log('Reading time badge added:', badge.textContent);
}

renderReadingTime(document.querySelector("article"));

