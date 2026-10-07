import { chromium, request } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, appendFileSync, existsSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
const exec=promisify(execFile);
const docker='C:/Users/Haely/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe';
const dir=resolve(process.env.PERFORMANCE_DIR??'artifacts/performance-test');
const imageTag=process.env.PERFORMANCE_IMAGE??'msm-performance-test:20261006';
const scripts=resolve('scripts').replaceAll('\\','/');
const mount=dir.replaceAll('\\','/');
const dbUrl='postgresql://postgres:performance-fixture-only@db:5432/msm_capacity_test?schema=public&connection_limit=10&pool_timeout=30';
const origin='https://localhost:54440';
const result={startedAt:new Date().toISOString(),scope:'Current workspace snapshot and exact lockfile production build. Synthetic 350k/500k-order datasets (2 marketplace customers, 100 products). HTTP virtual users, independent fixtures in one shared posting company; large-company reads use the 500k-order company. Not 20 actual browser sessions, WAN clients, all features, or a full-day soak.',capacity:[],stages:[],resources:[],browser:[],errors:[]};
if(existsSync(dir+'/results.json')) {Object.assign(result,JSON.parse(readFileSync(dir+'/results.json','utf8')));delete result.failure;result.completed=false;}
let phase='setup',monitorDone=false;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const save=()=>writeFileSync(dir+'/results.json',JSON.stringify(result,null,2));
async function resource() {try{const {stdout}=await exec(docker,['stats','--no-stream','--format','{{json .}}','msm-performance-backend','msm-performance-db','msm-performance-web']);const db=await exec(docker,['exec','msm-performance-db','psql','-U','postgres','-d','msm_capacity_test','-Atc',"SELECT json_build_object('databaseBytes',pg_database_size(current_database()),'connections',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()),'maxConnections',current_setting('max_connections'))"]);result.resources.push({at:new Date().toISOString(),phase,database:JSON.parse(db.stdout.trim()),containers:stdout.trim().split(/\r?\n/).map(x=>JSON.parse(x))});save();}catch(e){result.errors.push({type:'resource',message:e.message});}}
const monitor=(async()=>{while(!monitorDone){await resource();await sleep(15000);}})();
function containerScript(file,extra=[],name) {
 const args=['run','--rm',...(name?['--name',name]:[]),'--network','msm-performance-test','-v',`${mount}:/results`,'-v',`${scripts}:/app/scripts:ro`,'-e',`DATABASE_URL=${dbUrl}`,'-e',`CAPACITY_DATABASE_URL=${dbUrl}`,...extra,imageTag,'npx','tsx',`scripts/${file}`];
 const child=spawn(docker,args,{stdio:['ignore','pipe','pipe']});
 const log=createWriteStream(`${dir}/${name??file.replace('.ts','')}.log`);
 child.stdout.on('data',b=>{log.write(b);process.stdout.write(b);});child.stderr.on('data',b=>log.write(b));
 const done=new Promise((res,rej)=>{child.on('error',rej);child.on('exit',code=>{log.end();res(code);});});
 return {child,done};
}
async function waitFile(path,child) {const start=Date.now();while(!existsSync(path)){if(child.exitCode!==null)throw new Error(`Runner exited before ${path}`);if(Date.now()-start>20*60*1000)throw new Error(`Timed out waiting for ${path}`);await sleep(1000);}}
async function browserCheck(orgId,orders) {
 const browser=await chromium.launch({headless:true});const context=await browser.newContext({ignoreHTTPSErrors:true});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const measurements=[];
 try {
  await page.goto(origin+'/login');await page.fill('input[type="email"]','admin@demo.com');await page.fill('input[type="password"]','admin123');await page.click('button[type="submit"]');
  await page.getByTestId('company-picker-option').first().waitFor();await page.goto(`${origin}/?org=${orgId}`);await page.locator('nav').first().waitFor();
  await context.setExtraHTTPHeaders({'x-active-org':orgId});
  const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
  for(let round=0;round<3;round++) {
   let start=performance.now();
   await page.evaluate(()=>{history.pushState(null,'','/ar/invoices');dispatchEvent(new PopStateEvent('popstate'));});
   await page.getByText(`Showing 1–20 of ${orders.toLocaleString('en-US')} invoices`,{exact:true}).filter({visible:true}).waitFor();
   measurements.push({name:'invoice list visible',round,ms:performance.now()-start});
   start=performance.now();
   await page.getByRole('button',{name:'Last invoice page',exact:true}).filter({visible:true}).click();
   await page.getByText(`Showing ${orders-19}–${orders} of ${orders.toLocaleString('en-US')} invoices`,{exact:true}).filter({visible:true}).waitFor();
   await page.waitForTimeout(100);measurements.push({name:'last invoice page response and render',round,ms:performance.now()-start});
   await page.evaluate(()=>{history.pushState(null,'','/reports');dispatchEvent(new PopStateEvent('popstate'));});
   await page.getByRole('button',{name:/Sales by Customer/}).first().waitFor();start=performance.now();
   await page.getByRole('button',{name:/Sales by Customer/}).first().click();
   const dates=page.locator('input[type="date"]:visible');if(await dates.count()>=2){await dates.nth(0).fill('2025-01-01');await dates.nth(1).fill('2025-12-31');}
   await page.getByRole('button',{name:'Tampilkan',exact:true}).click();await page.getByRole('cell',{name:'Shopee',exact:true}).filter({visible:true}).first().waitFor();measurements.push({name:'annual sales report visible (may reuse query cache)',round,ms:performance.now()-start});
   const close=page.locator('.workbench-doc-tab-row').first().locator('.workbench-doc-tab-close');while(await close.count()){await close.last().click();await page.waitForTimeout(100);}
  }
  await cdp.send('HeapProfiler.collectGarbage');const metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  const body={orders,measurements,errors,jsHeapMiB:metrics.JSHeapUsedSize/1048576,dom:await cdp.send('Memory.getDOMCounters')};writeFileSync(`${dir}/browser-${orders}.json`,JSON.stringify(body,null,2));result.browser.push(body);assert.equal(errors.length,0);
  await page.screenshot({path:`${dir}/browser-${orders}.png`,fullPage:true});
 } catch(e) {await page.screenshot({path:`${dir}/browser-failure-${orders}.png`,fullPage:true});writeFileSync(`${dir}/browser-failure-${orders}.txt`,await page.locator('body').innerText());throw e;} finally{await browser.close();}
}
const percentile=(values,p)=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(p*sorted.length)-1)];};
async function loadStage(users,fixture,bigOrgId,{smoke=false}={}) {
 const duration=smoke?15000:600000;let started,deadline;
 const contexts=[];const records=[];const flows={invoice:0,bill:0,pos:0};const failures=[];const retries={invoice:0,bill:0,payment:0,pos:0,approval:0};
 for(let i=0;i<users;i++) {const ctx=await request.newContext({baseURL:origin,ignoreHTTPSErrors:true,timeout:60000});const login=await ctx.post('/api/v1/auth/login',{data:{email:fixture.workers[i].email,password:'PerformanceOnly123!'}});assert.equal(login.status(),200,await login.text());await login.dispose();contexts.push(ctx);}
 started=performance.now();deadline=started+duration;
 async function api(i,label,path,method='GET',body,orgId=fixture.orgId,expected=[200,201]) {
  const start=performance.now();let response,status=0,bytes=0,data;
  try {response=await contexts[i].fetch('/api/v1'+path,{method,headers:{'x-active-org':orgId},...(body?{data:body}:{})});status=response.status();const text=await response.text();bytes=Buffer.byteLength(text);data=JSON.parse(text);if(!expected.includes(status))throw new Error(`${label} HTTP ${status}: ${text.slice(0,300)}`);return data.data??data;
  } finally {const row={stage:smoke?'smoke':users,worker:i,label,method,status,ms:performance.now()-start,bytes,expected:expected.includes(status)};records.push(row);appendFileSync(dir+'/requests.ndjson',JSON.stringify(row)+'\n');await response?.dispose();}
 }
 const loops=Array(users).fill(0);const smokeTag=`SMOKE-${Date.now().toString(36)}`;
 const workers=contexts.map(async(_,i)=>{const w=fixture.workers[i];let seq=0;while(performance.now()<deadline) {seq++;loops[i]=seq;const prefix=`LOAD-${smoke?smokeTag:users}-${i}-${seq}`;try{
  await api(i,'invoice list',`/invoices?page=${seq%10===0?9999:1}&limit=20`,'GET',undefined,bigOrgId);
  if(seq%5===0) await api(i,'large annual sales','/reports/sales?type=by-customer','GET',undefined,bigOrgId);
  else await api(i,'trial balance','/reports/gl?type=trial-balance&asOfDate=2026-10-06');
  const kind=(seq+i)%3;
  if(kind===0){
   const payload={number:prefix,customerId:w.customerId,issueDate:'2026-10-06',tax:{enabled:false,inclusive:false,rate:0},lines:[{description:'Load service',quantity:1,price:1000}]};
   const inv=await api(i,'invoice create','/invoices','POST',payload);assert.equal(Number(inv.totalAmount),1000);
   const approval=await api(i,'invoice submit approval',`/invoices/${inv.id}/submit-approval`,'POST',{});
   await api((i+1)%users,'invoice approve',`/approvals/${approval.approvalRequestId}/approve`,'POST',{});
   const payment={customerId:w.customerId,date:'2026-10-06',method:'CASH',...(smoke?{cashAccountId:fixture.cashAccountId}:{depositAccountId:fixture.cashAccountId}),status:'COMPLETED',totalAmount:1000,reference:prefix,allocations:[{invoiceId:inv.id,amountApplied:1000}]};
   await api(i,'AR payment','/ar-payments','POST',payment);flows.invoice++;
   if(seq%10===0||smoke){await api(i,'invoice duplicate rejected','/invoices','POST',payload,fixture.orgId,[409]);retries.invoice++;await api(i,'overpayment rejected','/ar-payments','POST',payment,fixture.orgId,[422]);retries.payment++;await api((i+1)%users,'approval replay rejected',`/approvals/${approval.approvalRequestId}/approve`,'POST',{},fixture.orgId,[400,409]);retries.approval++;}
  } else if(kind===1){
   const payload={vendorId:w.vendorId,vendorInvoiceNo:prefix,issueDate:'2026-10-06',status:'OPEN',taxable:false,taxRate:0,subtotal:1000,totalAmount:1000,lines:[{lineNo:1,description:'Load expense',accountId:fixture.expenseAccountId,quantity:1,price:1000}]};
   const bill=await api(i,'bill post','/bills','POST',payload);assert.equal(Number(bill.totalAmount),1000);
   await api(i,'AP payment','/ap-payments','POST',{vendorId:w.vendorId,date:'2026-10-06',method:'CASH',cashAccountId:fixture.cashAccountId,status:'COMPLETED',totalAmount:1000,reference:prefix,allocations:[{billId:bill.id,amountApplied:1000}]});flows.bill++;
   if(seq%10===0||smoke){await api(i,'bill duplicate rejected','/bills','POST',payload,fixture.orgId,[409]);retries.bill++;}
  } else {
   const payload={clientSaleId:prefix,registerId:w.registerId,shiftId:w.shiftId,lines:[{itemId:w.itemId,description:'Load stock',quantity:1,price:2000,discountPct:0}],tenders:[{method:'CASH',amount:2000}]};
   const sale=await api(i,'POS checkout','/pos/sales','POST',payload);assert.equal(Number(sale.totalAmount),2000);
   const replay=await api(i,'POS replay','/pos/sales','POST',payload);assert.equal(replay.posSaleId,sale.posSaleId);flows.pos++;retries.pos++;
  }
 } catch(e){failures.push({worker:i,seq,message:e.message});console.log(`WORKLOAD ERROR ${users} users: ${e.message}`);if(smoke)break;await sleep(1000);}await sleep(2000);}});
 let tickerDone=false;const ticker=(async()=>{while(!tickerDone){await sleep(30000);if(tickerDone)break;console.log(JSON.stringify({phase:smoke?'smoke':`${users} users`,elapsedSeconds:Math.round((performance.now()-started)/1000),requests:records.length,flows,failures:failures.length}));}})();
 await Promise.all(workers);tickerDone=true;await Promise.all(contexts.map(c=>c.dispose()));
 const elapsed=(performance.now()-started)/1000;const group={};for(const r of records){(group[r.label]??=[]).push(r);}
 const stage={users,smoke,durationSeconds:elapsed,targetSeconds:duration/1000,requests:records.length,requestsPerSecond:records.length/elapsed,failedRequests:records.filter(r=>!r.expected).length,timeouts:failures.filter(f=>/timeout/i.test(f.message)).length,flowFailures:failures,flows,retries,loops,p50Ms:percentile(records.map(r=>r.ms),.5),p95Ms:percentile(records.map(r=>r.ms),.95),p99Ms:percentile(records.map(r=>r.ms),.99),operations:Object.entries(group).map(([name,rs])=>({name,count:rs.length,failed:rs.filter(r=>!r.expected).length,p50Ms:percentile(rs.map(r=>r.ms),.5),p95Ms:percentile(rs.map(r=>r.ms),.95),maxMs:Math.max(...rs.map(r=>r.ms))}))};
 writeFileSync(`${dir}/${smoke?'smoke':`load-${users}`}.json`,JSON.stringify(stage,null,2));if(!smoke)result.stages.push(stage);save();console.log(`STAGE COMPLETE ${JSON.stringify({users,smoke,seconds:elapsed,requests:records.length,failures:failures.length,p95Ms:stage.p95Ms})}`);return stage;
}
try {
 phase='load fixture';if(!existsSync(dir+'/load-fixture.json'))assert.equal(await containerScript('performance-fixture.ts',[],undefined).done,0);
 const fixture=JSON.parse(readFileSync(dir+'/load-fixture.json','utf8'));
 for(const orders of [350000,500000]){
  if(existsSync(`${dir}/capacity-${orders}.json`)&&existsSync(`${dir}/capacity-release-${orders}.json`))continue;
  phase=`${orders} orders database benchmark`;console.log(`START ${phase}`);
  const existing=existsSync(`${dir}/capacity-ready-${orders}.json`)&&!existsSync(`${dir}/capacity-release-${orders}.json`);
  const bench=existing?{child:{exitCode:null},done:exec(docker,['wait',`msm-performance-benchmark-${orders}`]).then(r=>Number(r.stdout.trim()))}:containerScript('performance-capacity.ts',['-e',`CAPACITY_ORDERS=${orders}`],`msm-performance-benchmark-${orders}`);
  await waitFile(`${dir}/capacity-ready-${orders}.json`,bench.child);
  const {orgId}=JSON.parse(readFileSync(`${dir}/capacity-ready-${orders}.json`,'utf8'));
  phase=`${orders} orders browser`;
  if (process.env.PERFORMANCE_SKIP_BROWSER === '1') {
   result.browser.push({orders,skipped:true,reason:'PERFORMANCE_SKIP_BROWSER=1; invoice pagination browser selectors require the separate pagination changes.'});save();
  } else { await browserCheck(orgId,orders); }
  if(orders===500000){
   phase='mixed workload smoke';const smoke=await loadStage(2,fixture,orgId,{smoke:true});assert.equal(smoke.flowFailures.length,0,'Mixed workload smoke failed');
   for(const users of [5,10,20]){phase=`${users} simultaneous users`;await loadStage(users,fixture,orgId);}
   phase='accounting invariant verification';
   const verified=await exec(docker,['run','--rm','--network','msm-performance-test','-v',`${mount}:/results`,'-v',`${scripts}:/app/scripts:ro`,'-e',`DATABASE_URL=${dbUrl}`,imageTag,'npx','tsx','scripts/performance-fixture.ts','verify'],{maxBuffer:1024*1024});writeFileSync(dir+'/invariants.log',verified.stdout);result.invariants=JSON.parse(readFileSync(dir+'/invariants.json','utf8'));
  }
  await exec(docker,['run','--rm','--network','msm-performance-test','-v',`${scripts}:/app/scripts:ro`,'-e',`DATABASE_URL=${dbUrl}`,imageTag,'npx','tsx','scripts/performance-release.ts',orgId]);
  writeFileSync(`${dir}/capacity-release-${orders}.json`,'{"released":true}');
  const exit=await bench.done;
  const capacity=JSON.parse(readFileSync(`${dir}/capacity-${orders}.json`,'utf8'));writeFileSync(resolve('docs/capacity-benchmark.latest.json'),JSON.stringify(capacity,null,2));result.capacity.push({...capacity,exitCode:exit});save();
 }
 result.completed=true;result.completedAt=new Date().toISOString();
} catch(e){result.completed=false;result.failure=e.stack;console.error(e);process.exitCode=1;}
finally{monitorDone=true;save();}
