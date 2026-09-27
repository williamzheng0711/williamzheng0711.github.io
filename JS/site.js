const navLinks = [...document.querySelectorAll('.menu-item')];
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    navLinks.forEach(link => link.classList.toggle('current', link.getAttribute('href') === `#${entry.target.id}`));
  }
}, { rootMargin: '-35% 0px -55% 0px' });
navLinks.map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean).forEach(section => observer.observe(section));

// The homepage supplies only personal place names; JourneySphere owns map assets.
const element = document.querySelector('journey-sphere');
async function renderTravelMap() {
  if (!element) return;
  try {
    const response = await fetch(new URL('../data/travel-places.json', import.meta.url));
    if (!response.ok) throw new Error('Travel record could not be loaded.');
    const places = await response.json();
    await customElements.whenDefined('journey-sphere');
    element.places = places;
    const journey = await element.ready;
    window.journeySphere = journey;
    performance.mark('travel-map-ready');
    document.querySelector('[data-reset-map]')?.addEventListener('click', () => element.reset());
  } catch (error) {
    element.textContent = `The travel map could not be loaded. ${error.message}`;
    console.error('JourneySphere:', error);
  }
}
renderTravelMap();
