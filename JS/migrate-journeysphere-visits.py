"""One-time legacy travel migration. Requires Python + Shapely (build tooling only)."""
import argparse
import json
import subprocess
from pathlib import Path
from shapely.geometry import shape
from shapely import make_valid

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description='Migrate legacy visits using a local journey-sphere checkout.')
parser.add_argument('journey_sphere_dir', type=Path, help='Path to the extracted journey-sphere repository')
args = parser.parse_args()
DATA = args.journey_sphere_dir.resolve() / 'data'
catalog = json.loads((DATA / 'catalog.json').read_text())
legacy = json.loads((ROOT / 'data/visited-boundaries.geojson').read_text())
# Read the authoritative old selection instead of assuming every stored polygon was visited.
script = "const fs=require('fs'),vm=require('vm');const c={window:{}};vm.createContext(c);vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),c);console.log(JSON.stringify(c.window.TRAVEL_MAP_DATA.VISITED_PLACES));"
places = json.loads(subprocess.check_output(['node', '-e', script, str(ROOT / 'JS/visited-places.js')]))
by_name = {f['properties']['name']: f for f in legacy['features']}
groups = {'taiwan':'TWN','korea':'KOR','japan':'JPN','usa':'USA','canada':'CAN','singapore':'SGP'}
shards = {}
visited, labels, migration = set(), {}, []
for place in places:
    for name in place['names']:
        old = by_name[name]
        code = groups.get(place.get('group'), 'CHN')
        if name == '香港特别行政区': code = 'HKG'
        if name == '澳门特别行政区': code = 'MAC'
        if code not in shards:
            features = json.loads((DATA / catalog['countries'][code]['file']).read_text())['features']
            shards[code] = [(f, make_valid(shape(f['geometry']))) for f in features]
        geometry = make_valid(shape(old['geometry']))
        matches = []
        for f,g in shards[code]:
            props = f['properties']
            if code == 'CHN' and (props['name'] == name or str(props.get('sourceCode')) == str(old['properties'].get('adcode'))):
                matches = [(f, 1.0)]
                break
            if not geometry.intersects(g): continue
            fraction = geometry.intersection(g).area / g.area if g.area else 0
            if fraction >= 0.5: matches.append((f,fraction))
        if not matches: raise RuntimeError(f'No faithful new region match for {code} {name}; do not silently expand visits.')
        for f,fraction in matches:
            rid = f['properties']['id']
            visited.add(rid)
            labels[rid] = place['label'] if len(matches)==1 else place['label'] + ' · ' + f['properties']['name']
        migration.append({'legacyName':name,'label':place['label'],'countryCode':code,'regionIds':[f['properties']['id'] for f,_ in matches]})
record = {'atlasVersion':catalog['version'],'visited':sorted(visited),'labels':dict(sorted(labels.items())),'migration':migration}
(ROOT / 'data/journeysphere-visits.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
print(f'Migrated all {len(migration)} old places to {len(visited)} stable atlas regions.')
