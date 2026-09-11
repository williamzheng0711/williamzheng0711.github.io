import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const dataRoot = new URL('../data/', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, dataRoot), 'utf8'));
const ready = existsSync(new URL('catalog.json', dataRoot));
function inRing([x,y], ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [xi,yi]=ring[i], [xj,yj]=ring[j];
    if ((yi>y)!==(yj>y) && x<(xj-xi)*(y-yi)/(yj-yi)+xi) inside=!inside;
  }
  return inside;
}
function contains(point,geometry) {
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  return polygons.some(rings=>inRing(point,rings[0])&&!rings.slice(1).some(r=>inRing(point,r)));
}
test('Korean coastline excludes known offshore water and retains visited-city land', { skip: !ready }, () => {
  const features=read('countries/KOR.geojson').features;
  for (const ocean of [[126.1,33.1],[126.9,33.6],[129.35,35.05]]) {
    assert.equal(features.some(f=>contains(ocean,f.geometry)),false,`Ocean point ${ocean} must not be colorable`);
  }
  for (const land of [[126.53,33.49],[129.0756,35.1796],[126.978,37.5665]]) {
    assert.equal(features.some(f=>contains(land,f.geometry)),true,`Land point ${land} must remain colorable`);
  }
});
test('tiny-country exceptions and prefecture-equivalent partition are explicit', { skip: !ready }, () => {
  const catalog=read('catalog.json');
  for(const code of ['SGP','VAT']) {
    assert.equal(catalog.countries[code].adminLevel,0);
    assert.equal(read(catalog.countries[code].file).features.length,1);
  }
  const china=read('countries/CHN.geojson');
  assert.ok(china.features.length>=300&&china.features.length<500,'China uses prefectures, not thousands of counties');
  assert.ok(china.features.some(f=>f.properties.name==='苏州市'));
  assert.equal(read('countries/TWN.geojson').features.length,22);
});
test('every country has a documented color, and the five requested colors are retained', { skip: !ready }, () => {
  const catalog=read('catalog.json'), palette=read('palette.json');
  for(const code of Object.keys(catalog.countries)) {
    assert.match(palette[code]?.color || '',/^#[0-9a-f]{6}$/i,code);
    assert.ok(palette[code].rationale?.length>3,`${code} color rationale`);
    assert.notEqual(palette[code].status,'provisional',`${code} must have an actual cultural color`);
  }
  for(const [code,color] of Object.entries({CHN:'#000095',KOR:'#C60C30',USA:'#00205B',CAN:'#EF3340'})) assert.equal(palette[code].color.toUpperCase(),color);
  const japan=palette.JPN.color;
  assert.ok(parseInt(japan.slice(1,3),16)>parseInt(japan.slice(5,7),16),'Japan is chrysanthemum gold');
});
test('Chinese cities, US counties and Japanese cities resolve to their first-level divisions', { skip: !ready }, () => {
  const china = read('countries/CHN.geojson');
  const usa = read('countries/USA.geojson');
  const japan = read('countries/JPN.geojson');
  const byName = (data, name) => data.features.find(f => f.properties.name === name)?.properties.parentId;
  const byId = (data, id) => data.features.find(f => f.properties.id === id)?.properties.parentId;
  assert.ok(byName(china, '苏州市'));
  assert.equal(byName(china, '苏州市'), byName(china, '南京市'));
  assert.equal(byName(china, '广州市'), byName(china, '深圳市'));
  assert.notEqual(byName(china, '苏州市'), byName(china, '广州市'));
  const kyoto = byId(japan, 'JPN:ADM2:22064153B57425006507818');
  assert.ok(kyoto);
  assert.equal(kyoto, byId(japan, 'JPN:ADM2:22064153B56990836800595'));
  assert.equal(kyoto, byId(japan, 'JPN:ADM2:22064153B24851023127688'));
  assert.notEqual(kyoto, byId(japan, 'JPN:ADM2:22064153B3938039280311'));
  const massachusetts = byId(usa, 'USA:ADM2:52423323B97000000441045');
  assert.ok(massachusetts);
  assert.equal(massachusetts, byId(usa, 'USA:ADM2:52423323B1907827935694'));
  assert.notEqual(massachusetts, byId(usa, 'USA:ADM2:52423323B79763443872127'));
  for (const data of [china, usa, japan]) {
    const parents = new Set(data.admin1.features.map(f => f.properties.id));
    assert.ok(parents.size > 1);
    for (const f of data.features) assert.ok(parents.has(f.properties.parentId), `${f.properties.id} has a valid first-level outline`);
  }
});

test('Korean special and metropolitan cities are single display regions', { skip: !ready }, () => {
  const catalog = read('catalog.json');
  const korea = read('countries/KOR.geojson');
  const singleParents = [
    'KOR:ADM1:KOR-2495',
    'KOR:ADM1:KOR-2497',
    'KOR:ADM1:KOR-2500',
    'KOR:ADM1:KOR-2503',
    'KOR:ADM1:KOR-2504',
    'KOR:ADM1:KOR-2507',
    'KOR:ADM1:KOR-2508',
  ];
  for (const parentId of singleParents) {
    const regions = korea.features.filter(feature => feature.properties.parentId === parentId);
    assert.equal(regions.length, 1, `${parentId} must not expose district children`);
    assert.equal(regions[0].properties.id, parentId);
    assert.equal(regions[0].properties.adminLevel, 1);
  }
  assert.equal(korea.features.some(feature => feature.properties.id === 'KOR:ADM2:91817680B54012703126739'), false);
  assert.equal(korea.features.some(feature => feature.properties.id === 'KOR:ADM2:91817680B91211823266814'), false);
  assert.match(catalog.countries.KOR.semantics, /special and metropolitan cities are single regions/);
});
