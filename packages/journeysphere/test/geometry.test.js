import test from 'node:test';
import assert from 'node:assert/strict';
import { featuresNearLongitudeCopies } from '../src/geometry.js';
const feature = { type: 'Feature', properties: { id: 'TST:ADM2:1' }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] } };
test('three world copies preserve input and region identity', () => {
  const before = structuredClone(feature);
  const copies = featuresNearLongitudeCopies([feature], 0);
  assert.equal(copies.length, 3);
  assert.deepEqual(copies.map(f=>f.properties.id), Array(3).fill(feature.properties.id));
  assert.deepEqual(copies.map(f=>f.geometry.coordinates[0][0][0]), [0,-360,360]);
  assert.deepEqual(feature, before);
});
test('dateline-split land is kept beside the dateline, never across the whole map', () => {
  const f = { ...feature, geometry: {type:'MultiPolygon',coordinates:[[[[179,0],[180,0],[180,1],[179,1],[179,0]]],[[[-180,0],[-179,0],[-179,1],[-180,1],[-180,0]]]]}};
  const [copy] = featuresNearLongitudeCopies([f], 180);
  const points = copy.geometry.coordinates.flat(2);
  const xs = points.map(p=>p[0]);
  assert.ok(Math.max(...xs)-Math.min(...xs) <= 2);
});
test('polar caps do not grow beyond one world when recentered at the dateline', () => {
  const polar = { ...feature, geometry: { type: 'Polygon', coordinates: [[[-180,-90],[-180,-80],[0,-75],[180,-80],[180,-90],[-180,-90]]] } };
  for (const longitude of [0,180,-180,360]) {
    const copies = featuresNearLongitudeCopies([polar],longitude);
    for(const copy of copies) {
      const xs=copy.geometry.coordinates[0].map(p=>p[0]);
      assert.equal(Math.max(...xs)-Math.min(...xs),360);
    }
  }
});
test('empty polygon parts do not crash polar-cap detection', () => {
  const empty = {...feature,geometry:{type:'MultiPolygon',coordinates:[[]]}};
  assert.doesNotThrow(()=>featuresNearLongitudeCopies([empty],0));
});
