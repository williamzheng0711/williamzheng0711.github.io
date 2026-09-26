import { createCompiledJourneySphere } from 'https://cdn.jsdelivr.net/gh/williamzheng0711/journey-sphere@3b7fcbbded7a35b2574c6b74e8628f4ca330131e/src/compiled.js';
import manifest from 'https://cdn.jsdelivr.net/gh/williamzheng0711/journey-sphere@3b7fcbbded7a35b2574c6b74e8628f4ca330131e/data/compiled/manifest.js';

// Pin code and geometry to the same release so CDN updates cannot mix versions.
const JOURNEY_SPHERE_DATA_URL = 'https://cdn.jsdelivr.net/gh/williamzheng0711/journey-sphere@3b7fcbbded7a35b2574c6b74e8628f4ca330131e/data/';

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
    const response = await fetch(new URL('../data/journeysphere-visits.json', import.meta.url));
    if (!response.ok) throw new Error('Travel record could not be loaded.');
    const record = await response.json();
    if (record.atlasVersion !== manifest.version) throw new Error('Travel record and atlas versions do not match.');
    container.textContent = '';
    const journey = await createCompiledJourneySphere(container, {
      dataUrl: JOURNEY_SPHERE_DATA_URL, manifest, visited: record.visited, labels: record.labels,
      center: [31.5, 121.8], zoom: 4,
    });
    // The homepage is a consumer; all rendering and visit state live in the package.
    window.journeySphere = journey;
    document.querySelector('[data-reset-map]')?.addEventListener('click', () => {
      journey.reset().catch(error => console.error('JourneySphere reset failed:', error));
    });
  } catch (error) {
    container.textContent = `The travel map could not be loaded. ${error.message}`;
    console.error('JourneySphere:', error);
  }
}
renderTravelMap();
