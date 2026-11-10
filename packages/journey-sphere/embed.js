// Start the largest dependency alongside the component's module graph.
if (globalThis.document) {
  const engine = document.createElement('link');
  engine.rel = 'modulepreload';
  engine.href = new URL('./vendor/leaflet/leaflet.esm.min.js', import.meta.url).href;
  engine.crossOrigin = 'anonymous';
  document.head.append(engine);
  // With the smaller engine, module discovery would otherwise leave the
  // connection idle before connectedCallback starts public world context.
  // Match fetch's CORS/same-origin credentials so the later request reuses it.
  if ([...document.querySelectorAll('journey-sphere')].some(element => !element.getAttribute('data-base-url'))) {
    const world = document.createElement('link');
    world.rel = 'preload';
    world.as = 'fetch';
    world.href = new URL('./data/embed/world.json', import.meta.url).href;
    world.crossOrigin = 'anonymous';
    document.head.append(world);
  }
}
await import('./src/embed.js');
