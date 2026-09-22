import { ESheep } from './DesktopPet';
// import './demo.css';

const ANIMATION_URL = 'https://esheep.petrucci.ch/script/animation.php';
const MIMIKO_ANIMATIONS_XML = 'https://raw.githubusercontent.com/Adrianotiger/desktopPet/refs/heads/master/Pets/mimiko/animations.xml';
const pets: ESheep[] = [];

const startButton = document.querySelector<HTMLButtonElement>('#start-button');
const clearButton = document.querySelector<HTMLButtonElement>('#clear-button');
const statusLine = document.querySelector<HTMLParagraphElement>('#status-line');
const petCount = document.querySelector<HTMLElement>('#pet-count');

function updateCount(): void {
  if (petCount) petCount.textContent = String(pets.length);
}

function updateStatus(message: string): void {
  if (statusLine) statusLine.textContent = message;
}

async function addPet(): Promise<void> {
  const pet = new ESheep();
  pets.push(pet);
  updateCount();
  updateStatus('Waking up a sheep...');

  await pet.Start();
  updateStatus(`${pets.length} ${pets.length === 1 ? 'sheep is' : 'sheep are'} exploring the page.`);
}

function clearPets(): void {
  while (pets.length > 0) pets.pop()?.Destroy();
  updateCount();
  updateStatus('The page is quiet again.');
}

startButton?.addEventListener('click', () => void addPet());
clearButton?.addEventListener('click', clearPets);

void addPet();