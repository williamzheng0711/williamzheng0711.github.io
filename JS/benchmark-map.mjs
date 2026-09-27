import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../', import.meta.url);
const baseRef = process.env.BASELINE_REF || 'b295e453926de6664f0e3eab9f045307c5729f87';
const old = new Map(['index.html', 'JS/site.js'].map(file => [file, execFileSync('git', ['show', `${baseRef}:${file}`], {cwd:root, encoding:'utf8'})]));
const cdn = 'https://cdn.jsdelivr.net/gh/williamzheng0711/journey-sphere@3b7fcbbded7a35b2574c6b74e8628f4ca330131e/';
const mime = {html:'text/html', js:'text/javascript', json:'application/json', css:'text/css', png:'image/png'};
const server = createServer(async (req,res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const baseline = url.pathname.startsWith('/baseline/');
    const file = url.pathname.replace(/^\/(baseline|current)\//, '') || 'index.html';
    if (file.includes('..')) throw new Error('Invalid path');
    let body = baseline && old.has(file) ? Buffer.from(old.get(file).replaceAll(cdn, '/baseline/packages/journey-sphere/').replaceAll('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/', '/baseline/packages/leaflet/')) : await readFile(new URL(file, root));
    res.writeHead(200, {'Content-Type':mime[file.split('.').pop()] || 'application/octet-stream', 'Content-Encoding':'gzip', 'Cache-Control':'no-store'});
    res.end(gzipSync(body));
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true, channel:'chrome'});
const results = {baseline:[],current:[]};
try {
  for(let run=0;run<4;run++) for(const variant of run%2?['current','baseline']:['baseline','current']) {
    const context = await browser.newContext({viewport:{width:1280,height:900}});
    // Keep font availability identical; no external map dependency may be needed.
    await context.route('https://**/*', route=>route.abort());
    const page = await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:100000});
    await page.goto(`${origin}/${variant}/index.html`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!window.journeySphere,{timeout:90000});
    const timing = await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {ms:performance.now(),bytes:performance.getEntriesByType('resource').reduce((n,r)=>n+r.encodedBodySize,0),visited:window.journeySphere.getVisited().length};});
    assert.equal(timing.visited,55);
    if(run)results[variant].push(timing);
    console.log(JSON.stringify({run,variant,...timing}));
    if(variant==='current' && run===0) {
      await page.evaluate(()=>window.journeySphere.detailsReady);
      await page.locator('#china-map').scrollIntoViewIfNeeded();
      await page.evaluate(async()=>{const j=window.journeySphere;const original=j.getVisited();window.originalWord=j.getCodeword();await j.setVisited(original.slice(1));});
      assert.equal(await page.evaluate(()=>window.journeySphere.getVisited().length),54);
      await page.locator('[data-reset-map]').click();
      await page.waitForFunction(()=>window.journeySphere.getVisited().length===55);
      assert.equal(await page.evaluate(()=>window.journeySphere.getCodeword()===window.originalWord),true);
      await page.locator('.leaflet-control-zoom-in').click();
      await page.waitForFunction(()=>window.journeySphere.map.getZoom()>4 && !window.journeySphere.map._animatingZoom);
      await page.locator('[data-reset-map]').click();
      await page.waitForFunction(()=>window.journeySphere.map.getZoom()===4);
      assert.ok(await page.locator('#china-map canvas').count());
      await page.locator('#china-map').screenshot({path:'/tmp/travel-map-verified.png'});
      console.log('PASS: render, selection, reset, zoom, codeword round trip');
    }
    assert.deepEqual(errors,[]);
    await context.close();
  }
  const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const before=median(results.baseline.map(x=>x.ms)),after=median(results.current.map(x=>x.ms));
  console.log(JSON.stringify({network:'1.6 Mbps, 150 ms latency, empty browser cache, gzip; one warmup plus three alternating samples per variant',baselineMedian:before,currentMedian:after,improvementPercent:100*(1-after/before),results},null,2));
} finally {await browser.close();server.close();}
