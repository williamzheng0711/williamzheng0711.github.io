const WORLD_SHIFT_OFFSETS = [-1, 0, 1];

/**
 * Render compact atlas records directly into Leaflet tiles.
 * @param {object} L
 * @param {object} options
 */
export function createCompiledLayer(L, options) {
  if (!L?.GridLayer?.extend) throw new TypeError('JourneySphere compiled renderer requires Leaflet GridLayer.');
  const {
    world, extent, getCountries, getVisited, colorFor, fillOpacity = 0.44,
    labels, interactive = true, onToggle, onError,
  } = options || {};
  if (!world || !Array.isArray(world.features)) throw new TypeError('Compiled renderer requires world features.');
  if (!Number.isFinite(extent) || extent <= 0) throw new RangeError('Compiled renderer extent must be positive.');
  if (typeof getCountries !== 'function' || typeof getVisited !== 'function') {
    throw new TypeError('Compiled renderer requires getCountries and getVisited callbacks.');
  }

  let paths = new WeakMap();
  const pathFor = record => {
    if (!paths.has(record)) paths.set(record, new Path2D(record.d));
    return paths.get(record);
  };
  const recordsForCountries = () => {
    const countries = getCountries() || [];
    return countries.flatMap(country => country?.features || []);
  };
  const admin1ForCountries = () => {
    const countries = getCountries() || [];
    return countries.flatMap(country => country?.admin1 || []);
  };
  const visitedSet = () => {
    const value = getVisited() || [];
    return value instanceof Set ? value : new Set(value);
  };
  const countrySet = visited => new Set([...visited].map(id => String(id).split(':')[0]));
  const parentKey = record => `${record.countryCode}:${record.parentId || record.id}`;
  const labelFor = record => typeof labels === 'function' ? labels(record.id, record) : labels?.[record.id] || record.name || record.id;
  const reportError = error => { if (typeof onError === 'function') onError(error); };

  function tileContext(canvas) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Compiled renderer could not create a 2D canvas context.');
    return context;
  }

  function tileShifts(record, coords, zoom) {
    if (!record.bounds) return WORLD_SHIFT_OFFSETS;
    const worldWidth = extent / (2 ** zoom);
    const left = coords.x * worldWidth;
    const right = left + worldWidth;
    const [minX, minY, maxX, maxY] = record.bounds;
    return WORLD_SHIFT_OFFSETS.filter(shift => {
      const shiftedMin = minX + shift * extent;
      const shiftedMax = maxX + shift * extent;
      return shiftedMax >= left && shiftedMin <= right && maxY >= coords.y * worldWidth && minY <= (coords.y + 1) * worldWidth;
    });
  }

  function drawRecord(context, record, coords, zoom, size, ratio, style) {
    const scale = (2 ** zoom) * size.x / extent;
    const shifts = tileShifts(record, coords, zoom);
    if (!shifts.length) return;
    const path = pathFor(record);
    for (const shift of shifts) {
      context.save();
      context.setTransform(scale * ratio, 0, 0, scale * ratio,
        -coords.x * size.x * ratio, -coords.y * size.y * ratio);
      context.translate(shift * extent, 0);
      context.lineWidth = style.weight / scale;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.strokeStyle = style.color;
      context.globalAlpha = style.opacity ?? 1;
      if (style.fill) {
        context.fillStyle = style.fill;
        context.globalAlpha = style.fillOpacity;
        context.fill(path, 'evenodd');
      }
      if (style.stroke !== false) {
        context.globalAlpha = style.opacity ?? 1;
        context.stroke(path);
      }
      context.restore();
    }
  }

  function scene() {
    const visited = visitedSet();
    const activeCountries = countrySet(visited);
    const activeRecords = recordsForCountries();
    const recordsById = new Map(activeRecords.map(record => [record.id, record]));
    const activeParents = new Set([...visited].map(id => recordsById.get(id)).filter(Boolean).map(parentKey));
    const selected = record => visited.has(record.id);
    const sibling = record => activeParents.has(parentKey(record)) && !selected(record);
    return { visited, activeCountries, activeParents, activeRecords, adminRecords: admin1ForCountries(), selected, sibling };
  }

  const Layer = L.GridLayer.extend({
    createTile(coords) {
      let tile;
      try {
        const size = this.getTileSize();
        if (!size?.x || !size?.y) throw new Error('Compiled renderer received an invalid tile size.');
        const ratio = globalThis.devicePixelRatio || 1;
        tile = document.createElement('canvas');
        tile.width = Math.round(size.x * ratio);
        tile.height = Math.round(size.y * ratio);
        tile.style.width = `${size.x}px`;
        tile.style.height = `${size.y}px`;
        const context = tileContext(tile);
        const state = this._compiledScene || (this._compiledScene = scene());
        const countryRecords = state.activeRecords;
        const adminRecords = state.adminRecords;
        const activeWorld = feature => state.activeCountries.has(feature.countryCode);
        for (const feature of world.features) {
          drawRecord(context, feature, coords, coords.z, size, ratio, {
            color: activeWorld(feature) ? '#8795a6' : '#c1cbd5', weight: activeWorld(feature) ? 0.8 : 0.45,
            fill: '#f8fafc', fillOpacity: 0.84,
          });
        }
        for (const feature of adminRecords) {
          if (!state.activeCountries.has(feature.countryCode)) continue;
          const activeParent = state.activeParents.has(parentKey(feature));
          drawRecord(context, feature, coords, coords.z, size, ratio, {
            color: '#8795a6', weight: activeParent ? 0.8 : 0.55, opacity: activeParent ? 0.75 : 0.4, stroke: true,
          });
        }
        for (const feature of countryRecords) {
          if (!state.activeCountries.has(feature.countryCode) || (!state.selected(feature) && !state.sibling(feature))) continue;
          const isSelected = state.selected(feature);
          drawRecord(context, feature, coords, coords.z, size, ratio, {
            color: isSelected ? colorFor?.(feature.countryCode) || '#64748b' : '#9aa8b7',
            weight: isSelected ? 1.05 : 0.55,
            opacity: isSelected ? 0.88 : 0.65,
            fill: isSelected ? colorFor?.(feature.countryCode) || '#64748b' : undefined,
            fillOpacity: isSelected ? fillOpacity : 0,
          });
        }
      } catch (error) {
        reportError(error);
        throw error;
      }
      return tile;
    },
    onAdd(map) {
      L.GridLayer.prototype.onAdd.call(this, map);
      this._compiledMap = map;
      this._compiledScene = scene();
      map.on('mousemove', this._compiledHover, this);
      map.on('mouseout', this._clearCompiledHover, this);
      map.on('movestart', this._clearCompiledHover, this);
      if (interactive) map.on('click', this._compiledClick, this);
      this._compiledTooltip = L.tooltip?.({ sticky: true });
    },
    onRemove(map) {
      map.off('click', this._compiledClick, this);
      map.off('mousemove', this._compiledHover, this);
      map.off('mouseout', this._clearCompiledHover, this);
      map.off('movestart', this._clearCompiledHover, this);
      this._clearCompiledHover();
      this._compiledMap = null;
      this._compiledScene = null;
      this._compiledHitCanvas = null;
      this._compiledHitContext = null;
      this._compiledTooltip = null;
      this._compiledLabel = null;
      paths = new WeakMap();
      L.GridLayer.prototype.onRemove.call(this, map);
    },
    _clearCompiledHover() {
      if (this._compiledTooltip && this._compiledMap) this._compiledMap.removeLayer(this._compiledTooltip);
    },
    _hitRecord(event) {
      const map = this._compiledMap;
      if (!map) return null;
      const point = map.project(event.latlng, 0);
      const x = ((point.x % 256) + 256) % 256 * extent / 256;
      const y = point.y * extent / 256;
      const canvas = this._compiledHitCanvas || (this._compiledHitCanvas = document.createElement('canvas'));
      const context = this._compiledHitContext || (this._compiledHitContext = tileContext(canvas));
      const records = (this._compiledScene || (this._compiledScene = scene())).activeRecords;
      for (const record of records) {
        if (!record.bounds) continue;
        const [minX, minY, maxX, maxY] = record.bounds;
        for (const shift of WORLD_SHIFT_OFFSETS) {
          const shiftedX = x + shift * extent;
          if (shiftedX < minX || shiftedX > maxX || y < minY || y > maxY) continue;
          const path = pathFor(record);
          if (context.isPointInPath(path, shiftedX, y, 'evenodd')) return record;
        }
      }
      return null;
    },
    _compiledClick(event) {
      const record = this._hitRecord(event);
      if (!record || !interactive || typeof onToggle !== 'function') return;
      try { Promise.resolve(onToggle(record.id)).catch(reportError); } catch (error) { reportError(error); }
    },
    _compiledHover(event) {
      const record = this._hitRecord(event);
      const visited = visitedSet();
      if (!record || !visited.has(record.id) || !this._compiledTooltip || !this._compiledMap) {
        this._clearCompiledHover();
        return;
      }
      const label = this._compiledLabel || (this._compiledLabel = document.createElement('span'));
      label.textContent = String(labelFor(record));
      this._compiledTooltip.setLatLng(event.latlng).setContent(label).addTo(this._compiledMap);
    },
    refresh() {
      this._clearCompiledHover();
      this._compiledScene = scene();
      this.redraw();
    },
  });

  return new Layer();
}
