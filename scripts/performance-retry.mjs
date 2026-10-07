import {request} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
const dir='artifacts/performance-test/';
const fixture=JSON.parse(readFileSync(dir+'load-fixture.json'));
const ctx=await request.newContext({baseURL:'https://localhost:54440',ignoreHTTPSErrors:true,extraHTTPHeaders:{'x-active-org':fixture.orgId},timeout:60000});
const result={startedAt:new Date().toISOString(),scope:'Sequential recovery of unfinished synthetic workflows after the timed stages; excluded from load-stage latency and error statistics.',approvals:0,arPayments:0,apPayments:0,errors:[]};
async function api(path,method='GET',data){const r=await ctx.fetch('/api/v1'+path,{method,...(data?{data}:{})});const text=await r.text();const status=r.status();await r.dispose();if(status>=400)throw new Error(`${path} ${status} ${text.slice(0,250)}`);const body=JSON.parse(text);return body.data??body;}
try {
 await api('/auth/login','POST',{email:'admin@demo.com',password:'admin123'});
 const approvals=await api('/approvals?type=INVOICE');
 for(const a of approvals){if(a.document.number.startsWith('LOAD-')){await api(`/approvals/${a.id}/approve`,'POST',{});result.approvals++;}}
 for(const [kind,status,party,key,field] of [['ar','SENT','customerId','invoiceId','depositAccountId'],['ap','OPEN','vendorId','billId','cashAccountId']]) {
  while(true){const page=await api(`/${kind==='ar'?'invoices':'bills'}?status=${status}&limit=100`);const rows=Array.isArray(page)?page:page.data;
   if(!rows?.length)break;
   for(const doc of rows){if(Number(doc.totalAmount)!==1000)throw new Error('Unexpected recovery fixture amount');await api(`/${kind}-payments`,'POST',{[party]:doc[party],date:'2026-10-06',method:'CASH',[field]:fixture.cashAccountId,status:'COMPLETED',totalAmount:1000,reference:'sequential recovery after load',allocations:[{[key]:doc.id,amountApplied:1000}]});result[kind==='ar'?'arPayments':'apPayments']++;}
  }
 }
 result.completed=true;
}catch(e){result.completed=false;result.errors.push(e.message);process.exitCode=1;}finally{result.completedAt=new Date().toISOString();writeFileSync(dir+'retry-recovery.json',JSON.stringify(result,null,2));await ctx.dispose();console.log(JSON.stringify(result));}
