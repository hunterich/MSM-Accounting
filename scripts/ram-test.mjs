import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const docker = 'C:/Users/Haely/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe';
const output = 'artifacts/ram-test/results.json';
const started = performance.now();
const result = { startedAt:new Date().toISOString(), scope:'Deployed production images; synthetic demo seed; 20 repeated SPA cycles, 10 open invoice forms, 6-minute idle. Not a large-data/import/OCR or full-day soak test.', samples:[], errors:[], actions:[] };
const flush = () => writeFileSync(output, JSON.stringify(result,null,2));
const server = await chromium.launchServer({headless:true});
const pid = server.process().pid;
const browser = await chromium.connect(server.wsEndpoint());
const context = await browser.newContext({ignoreHTTPSErrors:true});
const page = await context.newPage();
page.on('dialog',d=>d.accept());
page.on('pageerror',e=>result.errors.push({type:'page',message:e.message}));
let authenticated = false;
page.on('response',r=>{if(authenticated && r.status()>=400 && r.url().includes('/api/')) result.errors.push({type:'http',status:r.status(),url:r.url()});});
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');
const MiB = bytes => Math.round(bytes/1048576*100)/100;
async function sample(label, gc=false) {
  if(gc) await cdp.send('HeapProfiler.collectGarbage');
  const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  const dom = await cdp.send('Memory.getDOMCounters');
  const ps = `$all=Get-CimInstance Win32_Process; $ids=[System.Collections.Generic.HashSet[int]]::new(); [void]$ids.Add(${pid}); do { $added=$false; foreach($p in $all) { if($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $added=$true } } } while($added); $ws=0L; $private=0L; $count=0; foreach($id in $ids) { $p=Get-Process -Id $id -ErrorAction SilentlyContinue; if($p) { $ws+=$p.WorkingSet64; $private+=$p.PrivateMemorySize64; $count++ } }; @{workingSetBytes=$ws;privateBytes=$private;processes=$count} | ConvertTo-Json -Compress`;
  const processes = JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',ps],{encoding:'utf8'}));
  const containers = execFileSync(docker,['stats','--no-stream','--format','{{json .}}','msm-ram-test-backend','msm-ram-test-db','msm-ram-test-web'],{encoding:'utf8'}).trim().split(/\r?\n/).map(x=>{const s=JSON.parse(x); return {name:s.Name,memory:s.MemUsage,cpu:s.CPUPerc};});
  const tabs = await page.locator('.workbench-doc-tab-row').first().locator('.workbench-doc-tab').count();
  const s={label,seconds:Math.round((performance.now()-started)/1000),forcedGC:gc,jsHeapMiB:MiB(metrics.JSHeapUsedSize),heapAllocatedMiB:MiB(metrics.JSHeapTotalSize),dom,modules:tabs,browser:{workingSetMiB:MiB(processes.workingSetBytes),privateMiB:MiB(processes.privateBytes),processes:processes.processes},containers};
  result.samples.push(s); flush(); console.log(JSON.stringify(s));
}
async function navigate(path) {
  await page.evaluate(p=>{history.pushState(null,'',p);dispatchEvent(new PopStateEvent('popstate'));},path);
  await page.waitForTimeout(750);
  if(new URL(page.url()).pathname!==path) throw new Error(`Navigation failed: ${path}`);
  await page.locator('nav').first().waitFor();
}
async function closeModules() {
  const closes=page.locator('.workbench-doc-tab-row').first().locator('.workbench-doc-tab-close');
  for(let i=0;i<12 && await closes.count();i++) {await closes.last().click();await page.waitForTimeout(150);}
}
async function cycle(index) {
  for(const path of ['/ar/invoices','/ar/customers','/ap/bills','/inventory/items','/banking','/reports']) await navigate(path);
  await page.getByRole('button',{name:/Sales by Customer/}).first().click();
  await page.getByRole('button',{name:'Tampilkan',exact:true}).click();
  await page.waitForTimeout(1000);
  await closeModules();
  result.actions.push({cycle:index,routes:6,reportsRun:1,closedModules:true});
}
try {
  await page.goto('https://localhost:54439/login');
  await page.fill('input[type="email"]','admin@demo.com');
  await page.fill('input[type="password"]','admin123');
  await page.click('button[type="submit"]');
  await page.getByTestId('company-picker-option').first().waitFor();
  await page.getByTestId('company-picker-option').first().click();
  await page.locator('nav').first().waitFor();
  await page.waitForTimeout(2000); authenticated=true;
  await sample('cold dashboard');
  for(let i=1;i<=3;i++) await cycle(`warmup-${i}`);
  await sample('warmed baseline after closing modules',true);
  for(let i=1;i<=20;i++) {await cycle(i); await sample(`closed cycle ${i}`,true);}
  await navigate('/ar/invoices');
  for(let i=0;i<10;i++) {await page.locator('.workbench-doc-tab-new').click();await page.waitForTimeout(500);}
  result.openForms=await page.locator('.secondary-row .workbench-doc-tab-scroll .workbench-doc-tab').count();
  await sample('10 invoice forms open',true);
  await closeModules();
  await sample('invoice forms closed',true);
  for(let i=1;i<=12;i++) {await page.waitForTimeout(30000); await sample(`idle ${i*30} seconds`);}
  await sample('final idle after GC',true);
  result.completedAt=new Date().toISOString(); result.completed=true;
  await page.screenshot({path:'artifacts/ram-test/final.png',fullPage:true});
} catch(e) {
  result.completed=false;result.failure=e.stack;console.error(e);
  await page.screenshot({path:'artifacts/ram-test/failure.png',fullPage:true}).catch(()=>{});
  writeFileSync('artifacts/ram-test/failure-body.txt',await page.locator('body').innerText().catch(()=>''));
  process.exitCode=1;
} finally {flush();await browser.close();await server.close();}
