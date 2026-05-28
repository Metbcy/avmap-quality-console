import { chromium } from 'playwright';
const b = await chromium.launch({args:['--no-sandbox']});
const ctx = await b.newContext({viewport:{width:1600,height:1100}});
const p = await ctx.newPage();
// Block heavy basemap tiles so we don't wait forever for CARTO
await p.route('**/*', r => {
  const u = r.request().url();
  if (/basemaps\.cartocdn|tile\.openstreetmap/.test(u)) return r.abort();
  return r.continue();
});
await p.goto('https://metbcy.github.io/avmap-quality-console/', {waitUntil:'domcontentloaded', timeout:60000});
// poll for non-3599 tile count
let stat = '';
for (let i=0;i<30;i++){
  await p.waitForTimeout(1000);
  stat = await p.evaluate(() => document.body.innerText.match(/total tiles[\s\S]{0,30}/)?.[0] || '');
  console.log(i, stat.replace(/\s+/g,' '));
  if (/2[34]\d\d/.test(stat)) break;
}
await p.screenshot({path:'/tmp/avmap3.png', timeout:30000});
await b.close();
console.log('done', stat.replace(/\s+/g,' '));
