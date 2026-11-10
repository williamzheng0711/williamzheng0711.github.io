import { bindLongPress } from './place-interactions.js';

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
    labels, onError, getOutline = () => null, outlineRegionIds = [],
  } = options || {};
  if (!world || !Array.isArray(world.features)) throw new TypeError('Compiled renderer requires world features.');
  if (!Number.isFinite(extent) || extent <= 0) throw new RangeError('Compiled renderer extent must be positive.');
  if (typeof getCountries !== 'function' || typeof getVisited !== 'function') {
    throw new TypeError('Compiled renderer requires getCountries and getVisited callbacks.');
  }

  let paths = new WeakMap();
  let strokePaths = new WeakMap();
  let replacements = new WeakMap();
  let tileCoords = new WeakMap();
  const replaceable = new Set(outlineRegionIds);
  const detailedRecord = (record, zoom) => {
    const outline = getOutline(record.countryCode, zoom);
    if (!outline) return record;
    let records = replacements.get(outline);
    if (!records) replacements.set(outline, records = new WeakMap());
    if (!records.has(record)) records.set(record, {
      ...record, d: outline.d, bounds: outline.bounds, parts: outline.parts, strokeWidths: outline.strokeWidths,
    });
    return records.get(record);
  };
  const pathFor = (record, stroke = false, zoom = 0) => {
    if (stroke && record.strokeWidths) {
      let cached = strokePaths.get(record);
      if (!cached) {
        const positiveWidths = [...new Set(record.strokeWidths.filter(width => Number.isFinite(width) && width > 0))].sort((a, b) => a - b);
        cached = { rings: record.d.match(/M[^M]+/g), positiveWidths, paths: new Map() };
        strokePaths.set(record, cached);
      }
      const minimumWidth = 0.5 * extent / (256 * 2 ** zoom);
      const firstEligible = cached.positiveWidths.findIndex(width => width >= minimumWidth);
      // Positive widths are sorted, so the first eligible width uniquely identifies
      // the complete eligible suffix. The exterior ring (null) remains unconditional.
      const key = firstEligible < 0 ? 'none' : String(cached.positiveWidths[firstEligible]);
      if (!cached.paths.has(key)) {
        // Keep the exact fill; outline only supported holes wide enough to resolve.
        const rings = cached.rings.filter((_, index) => record.strokeWidths[index] === null ||
          record.strokeWidths[index] >= minimumWidth);
        cached.paths.set(key, new Path2D(rings.join(' ')));
      }
      return cached.paths.get(key);
    }
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

  function tileShifts(record, coords, zoom, padding) {
    const boxes = Array.isArray(record.parts) && record.parts.length
      ? record.parts : record.bounds ? [record.bounds] : null;
    if (!boxes) return WORLD_SHIFT_OFFSETS;
    const worldWidth = extent / (2 ** zoom);
    const left = coords.x * worldWidth;
    const right = left + worldWidth;
    return WORLD_SHIFT_OFFSETS.filter(shift => {
      return boxes.some(([minX, minY, maxX, maxY]) => {
        const shiftedMin = minX + shift * extent;
        const shiftedMax = maxX + shift * extent;
        return shiftedMax + padding >= left && shiftedMin - padding <= right &&
          maxY + padding >= coords.y * worldWidth && minY - padding <= (coords.y + 1) * worldWidth;
      });
    });
  }

  function drawRecord(context, record, coords, zoom, size, ratio, style) {
    const scale = (2 ** zoom) * size.x / extent;
    const shifts = tileShifts(record, coords, zoom, style.stroke === false ? 0 : style.weight / (2 * scale));
    if (!shifts.length) return;
    for (const shift of shifts) {
      context.save();
      try {
        context.setTransform(scale * ratio, 0, 0, scale * ratio,
          -coords.x * size.x * ratio, -coords.y * size.y * ratio);
        context.translate(shift * extent, 0);
        if (style.fill) {
          const path = pathFor(record);
          if (style.replaceFill) {
            // A later region owns its fill, including a custom color's alpha.
            // Clear only this geometry so overlapping translucent CSS colors do
            // not accumulate inside the shared fill buffer either.
            context.globalAlpha = 1;
            context.globalCompositeOperation = 'destination-out';
            context.fillStyle = '#000';
            context.fill(path, 'evenodd');
            context.globalCompositeOperation = 'source-over';
          }
          context.fillStyle = style.fill;
          context.globalAlpha = style.fillOpacity;
          context.fill(path, 'evenodd');
        }
        if (style.stroke !== false) {
          context.lineWidth = style.weight / scale;
          context.lineCap = 'round';
          context.lineJoin = 'round';
          context.strokeStyle = style.color;
          context.globalAlpha = style.opacity ?? 1;
          context.stroke(pathFor(record, true, zoom));
        }
      } finally { context.restore(); }
    }
  }

  function scene(zoom) {
    const visited = visitedSet();
    const activeCountries = countrySet(visited);
    const baseRecords = recordsForCountries();
    const replacementParents = new Set(baseRecords.filter(record => replaceable.has(record.id)).map(parentKey));
    const activeRecords = baseRecords.map(record => replaceable.has(record.id) ? detailedRecord(record, zoom) : record);
    const recordsById = new Map(activeRecords.map(record => [record.id, record]));
    const activeParents = new Set([...visited].map(id => recordsById.get(id)).filter(Boolean).map(parentKey));
    const selected = record => visited.has(record.id);
    const sibling = record => activeParents.has(parentKey(record)) && !selected(record);
    return { zoom, visited, activeCountries, activeParents, activeRecords, selected,
      worldRecords: world.features.map(record => getOutline(record.countryCode, zoom) || record),
      adminRecords: admin1ForCountries().map(record => replacementParents.has(parentKey(record)) ? detailedRecord(record, zoom) : record),
      visibleRegions: activeRecords.filter(record => activeCountries.has(record.countryCode) && (selected(record) || sibling(record))),
    };
  }

  const Layer = L.GridLayer.extend({
    _update(center) {
      L.GridLayer.prototype._update.call(this, center);
      // Canvas pixels are drawn synchronously. Wait until Leaflet registers and
      // attaches the whole batch, then expose it in this turn instead of leaving
      // hard view changes empty until its usual next-frame readiness callback.
      for (const tile of Object.values(this._tiles || {})) {
        if (!this._map) break;
        const key = this._tileCoordsToKey(tile.coords);
        if (this._tiles[key] !== tile || tile.loaded || !tileCoords.has(tile.el)) continue;
        this._tileReady(tile.coords, null, tile.el);
      }
    },
    redraw() {
      const previous = this._compiledPaintedWorld;
      this._compiledPaintedWorld = null;
      this._compiledMixedOutlines = false;
      if (!this._map || !this._tiles) {
        return L.GridLayer.prototype.redraw.call(this);
      }
      // Replacing loaded tiles hides the entire map until Leaflet marks the new
      // tiles ready on its next frame. Repaint their pixels without changing
      // their visibility, native zoom levels, wrapping grid or DOM ownership.
      try {
        const scratch = this._compiledRepaintCanvas || (this._compiledRepaintCanvas = document.createElement('canvas'));
        for (const { el: tile } of Object.values(this._tiles)) {
          const coords = tileCoords.get(tile);
          if (!coords) continue;
          // Retained parent/child levels must use their original wrapped coords;
          // Leaflet's current _wrapCoords grid belongs to the newest tile level.
          this._drawCompiledTile(scratch, coords);
          if (tile.width !== scratch.width) tile.width = scratch.width;
          if (tile.height !== scratch.height) tile.height = scratch.height;
          const context = tileContext(tile);
          context.save();
          try {
            context.setTransform(1, 0, 0, 1, 0, 0);
            context.globalAlpha = 1;
            context.globalCompositeOperation = 'copy';
            context.drawImage(scratch, 0, 0);
          } finally { context.restore(); }
        }
      } catch (error) {
        // A failed paint keeps the visible bitmap and can be retried later.
        this._compiledPaintedWorld = previous;
        this._compiledMixedOutlines = true;
        reportError(error);
      }
      return this;
    },
    requestOutlineRefresh() {
      this._compiledScene = null;
      this._refreshCompiledView();
      return this;
    },
    _refreshCompiledView() {
      if (!this._compiledMap || !this._compiledPaintedWorld) return;
      const state = this._sceneAt(this._compiledMap.getZoom());
      const previous = this._compiledPaintedWorld;
      if (this._compiledMixedOutlines || state.worldRecords.length !== previous.length ||
          state.worldRecords.some((record, index) => record !== previous[index])) this.requestRefresh();
    },
    _cancelCompiledRefresh() {
      const handle = this._compiledRefreshFrame;
      const cancel = this._compiledRefreshCancel;
      this._compiledRefreshFrame = null;
      this._compiledRefreshCancel = null;
      this._compiledRefreshQueued = false;
      this._compiledRefreshToken = (this._compiledRefreshToken || 0) + 1;
      if (handle !== null && handle !== undefined && typeof cancel === 'function') cancel(handle);
    },
    requestRefresh() {
      this._clearCompiledHover();
      this._compiledScene = null;
      if (!this._compiledMap || this._compiledRefreshQueued) return this;
      const token = (this._compiledRefreshToken || 0) + 1;
      this._compiledRefreshToken = token;
      this._compiledRefreshQueued = true;
      const repaint = () => {
        if (!this._compiledRefreshQueued || this._compiledRefreshToken !== token) return;
        this._compiledRefreshFrame = null;
        this._compiledRefreshCancel = null;
        this._compiledRefreshQueued = false;
        if (this._compiledMap) this.redraw();
      };
      const useFrame = typeof globalThis.requestAnimationFrame === 'function';
      this._compiledRefreshCancel = useFrame ? globalThis.cancelAnimationFrame : globalThis.clearTimeout;
      this._compiledRefreshFrame = useFrame
        ? globalThis.requestAnimationFrame(repaint) : globalThis.setTimeout(repaint, 0);
      return this;
    },
    _sceneAt(zoom) {
      // A partial country outline covers whole polygons near the live viewport.
      // Pans and resize can expose a missing part before moveend or any network
      // callback, so never reuse the old viewport's replacement scene there.
      const bounds = this._compiledMap?.getPixelBounds?.();
      const viewKey = bounds ? [bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y].join(',') : null;
      if (!this._compiledScene || this._compiledScene.zoom !== zoom || this._compiledScene.viewKey !== viewKey) {
        this._compiledScene = { ...scene(zoom), viewKey };
      }
      return this._compiledScene;
    },
    createTile(coords, _done) {
      const tile = document.createElement('canvas');
      try {
        this._drawCompiledTile(tile, coords);
        tileCoords.set(tile, { x: coords.x, y: coords.y, z: coords.z });
      } catch (error) {
        reportError(error);
        throw error;
      }
      return tile;
    },
    _drawCompiledTile(tile, coords) {
      const size = this.getTileSize();
      if (!size?.x || !size?.y) throw new Error('Compiled renderer received an invalid tile size.');
      const ratio = globalThis.devicePixelRatio || 1;
      tile.width = Math.round(size.x * ratio);
      tile.height = Math.round(size.y * ratio);
      tile.style.width = `${size.x}px`;
      tile.style.height = `${size.y}px`;
      const context = tileContext(tile);
      const zoom = this._compiledMap?.getZoom() ?? this._map?.getZoom() ?? coords.z;
      const state = this._sceneAt(zoom);
      const countryRecords = state.visibleRegions;
      const adminRecords = state.adminRecords;
      const activeWorld = feature => state.activeCountries.has(feature.countryCode);
      // Neighboring fills must finish before shared boundary strokes.
      this._drawCompiledFill(context, state.worldRecords, coords, size, ratio, 0.84, () => '#f8fafc');
      for (const feature of state.worldRecords) {
        drawRecord(context, feature, coords, coords.z, size, ratio, {
          color: activeWorld(feature) ? '#8795a6' : zoom >= 6 ? '#acb8c5' : '#c1cbd5',
          weight: activeWorld(feature) ? (zoom >= 6 ? 0.95 : 0.8) : (zoom >= 6 ? 0.65 : 0.45),
        });
      }
      // Different boundary sources can overlap (for example Zhuhai and Macao).
      // Composite the completed visit fill once so overlap is not a darker shade.
      this._drawCompiledFill(context, countryRecords.filter(state.selected), coords, size, ratio,
        fillOpacity, feature => colorFor?.(feature.countryCode) || '#64748b', true);
      for (const feature of adminRecords) {
        if (!state.activeCountries.has(feature.countryCode)) continue;
        const activeParent = state.activeParents.has(parentKey(feature));
        drawRecord(context, feature, coords, coords.z, size, ratio, {
          color: '#8795a6', weight: activeParent ? 0.8 : 0.55, opacity: activeParent ? 0.75 : 0.4, stroke: true,
        });
      }
      for (const feature of countryRecords) {
        const isSelected = state.selected(feature);
        drawRecord(context, feature, coords, coords.z, size, ratio, {
          color: isSelected ? colorFor?.(feature.countryCode) || '#64748b' : '#9aa8b7',
          weight: isSelected ? (zoom >= 6 ? 1.15 : 1.05) : 0.55,
          opacity: isSelected ? 0.88 : 0.65,
        });
      }
      if (!this._compiledPaintedWorld) this._compiledPaintedWorld = state.worldRecords;
      else if (state.worldRecords.some((record, index) => record !== this._compiledPaintedWorld[index])) this._compiledMixedOutlines = true;
    },
    _drawCompiledFill(context, records, coords, size, ratio, opacity, color, replaceFill = false) {
      if (!records.length || opacity === 0) return;
      // Separate from the retained-tile repaint canvas, which is this pass's
      // destination. One tile-sized buffer is reused for both fill passes.
      const fill = this._compiledFillCanvas || (this._compiledFillCanvas = document.createElement('canvas'));
      const width = Math.round(size.x * ratio);
      const height = Math.round(size.y * ratio);
      if (fill.width !== width) fill.width = width;
      if (fill.height !== height) fill.height = height;
      const fillContext = tileContext(fill);
      fillContext.save();
      try {
        fillContext.setTransform(1, 0, 0, 1, 0, 0);
        fillContext.clearRect(0, 0, width, height);
      } finally { fillContext.restore(); }
      for (const record of records) {
        drawRecord(fillContext, record, coords, coords.z, size, ratio, {
          fill: color(record), fillOpacity: 1, stroke: false, replaceFill,
        });
      }
      context.save();
      try {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalAlpha = opacity;
        context.globalCompositeOperation = 'source-over';
        context.drawImage(fill, 0, 0);
      } finally { context.restore(); }
    },
    onAdd(map) {
      L.GridLayer.prototype.onAdd.call(this, map);
      this._compiledMap = map;
      this._compiledRefreshFrame = null;
      this._compiledRefreshCancel = null;
      this._compiledRefreshQueued = false;
      this._compiledRefreshToken = (this._compiledRefreshToken || 0) + 1;
      this._compiledScene = scene(map.getZoom());
      map.on('mousemove', this._compiledHover, this);
      map.on('mouseout', this._clearCompiledHover, this);
      map.on('movestart', this._clearCompiledHover, this);
      map.on('moveend', this._refreshCompiledView, this);
      map.on('zoomend', this._refreshCompiledView, this);
      map.on('resize', this._refreshCompiledView, this);
      this._compiledTooltip = L.tooltip?.({ sticky: true });
      this._compiledLongPress = bindLongPress(map, {
        resolve: latlng => this._hitRecord({ latlng }),
        show: (record, latlng) => this._showCompiledName(record, latlng),
        hide: () => this._clearCompiledHover(),
      });
    },
    onRemove(map) {
      this._cancelCompiledRefresh();
      this._compiledLongPress?.destroy();
      this._compiledLongPress = null;
      map.off('mousemove', this._compiledHover, this);
      map.off('mouseout', this._clearCompiledHover, this);
      map.off('movestart', this._clearCompiledHover, this);
      map.off('moveend', this._refreshCompiledView, this);
      map.off('zoomend', this._refreshCompiledView, this);
      map.off('resize', this._refreshCompiledView, this);
      this._clearCompiledHover();
      this._compiledMap = null;
      this._compiledScene = null;
      this._compiledPaintedWorld = null;
      this._compiledMixedOutlines = false;
      this._compiledHitCanvas = null;
      this._compiledHitContext = null;
      this._compiledRepaintCanvas = null;
      this._compiledFillCanvas = null;
      this._compiledTooltip = null;
      this._compiledLabel = null;
      paths = new WeakMap();
      strokePaths = new WeakMap();
      replacements = new WeakMap();
      tileCoords = new WeakMap();
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
      const records = this._sceneAt(map.getZoom()).activeRecords;
      const visited = visitedSet();
      for (const record of records) {
        if (!visited.has(record.id) || !record.bounds) continue;
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
    _compiledHover(event) {
      if (this._compiledLongPress?.shouldIgnoreHover(event)) return;
      this._showCompiledName(this._hitRecord(event), event.latlng);
    },
    _showCompiledName(record, latlng) {
      const visited = visitedSet();
      if (!record || !visited.has(record.id) || !this._compiledTooltip || !this._compiledMap) {
        this._clearCompiledHover();
        return;
      }
      const label = this._compiledLabel || (this._compiledLabel = document.createElement('span'));
      label.textContent = String(labelFor(record));
      this._compiledTooltip.setLatLng(latlng).setContent(label).addTo(this._compiledMap);
    },
    refresh() {
      this._cancelCompiledRefresh();
      this._compiledLongPress?.cancel();
      this._clearCompiledHover();
      this._compiledScene = null;
      if (this._compiledMap) this.redraw();
      return this;
    },
  });

  return new Layer();
}
