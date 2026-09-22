const toggle = document.getElementById('toggle') as HTMLButtonElement;
const petStatus = document.getElementById('status') as HTMLParagraphElement;


function render(enabled: boolean) {
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.textContent = enabled ? 'Sheep are roaming' : 'Let a sheep roam';
    petStatus.textContent = enabled
        ? 'Your browsing companion is on.'
        : 'The sheep is taking a break.';
}


