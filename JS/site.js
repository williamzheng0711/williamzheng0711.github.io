import { createCompiledJourneySphere } from '../packages/journey-sphere/src/compiled.js';
import manifest from '../packages/journey-sphere/data/compiled/manifest.js';

// Keep the vendored renderer and geometry on the same atlas release.
const JOURNEY_SPHERE_DATA_URL = new URL('../packages/journey-sphere/data/', import.meta.url);

const navLinks = [...document.querySelectorAll('.menu-item')];
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    navLinks.forEach(link => link.classList.toggle('current', link.getAttribute('href') === `#${entry.target.id}`));
  }
}, { rootMargin: '-35% 0px -55% 0px' });
navLinks.map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean).forEach(section => observer.observe(section));

async function renderTravelMap() {
  const container = document.querySelector('#china-map');
  if (!container) return;
  container.textContent = 'Loading visited regions…';
  try {
    const response = await fetch(new URL('../packages/journey-sphere/data/startup.json', import.meta.url));
    if (!response.ok) throw new Error('Travel record could not be loaded.');
    const record = await response.json();
    if (record.atlasVersion !== manifest.version) throw new Error('Travel record and atlas versions do not match.');
    container.textContent = '';
    const journey = await createCompiledJourneySphere(container, {
      dataUrl: JOURNEY_SPHERE_DATA_URL, manifest, visited: record.visited, labels: record.labels,
      initialCountries: record.countries,
      center: [31.5, 121.8], zoom: 4,
    });
    // The homepage is a consumer; all rendering and visit state live in the package.
    window.journeySphere = journey;
    container.setAttribute('aria-busy', 'false');
    performance.mark('travel-map-ready');
    document.querySelector('[data-reset-map]')?.addEventListener('click', () => {
      journey.reset().catch(error => console.error('JourneySphere reset failed:', error));
    });
  } catch (error) {
    container.setAttribute('aria-busy', 'false');
    container.textContent = `The travel map could not be loaded. ${error.message}`;
    console.error('JourneySphere:', error);
  }
}
renderTravelMap();
