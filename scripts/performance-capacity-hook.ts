import type { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
export async function capacityHook(db:PrismaClient,orgId:string,orders:number) {
 await db.organization.update({where:{id:orgId},data:{costingMethod:'FIFO',fiscalYearStart:new Date('2025-01-01'),taxEnabled:false}});
 const role=await db.role.create({data:{organizationId:orgId,name:'Capacity admin',roleType:'ADMIN'}});
 const users=await db.user.findMany({where:{OR:[{email:'admin@demo.com'},{email:{endsWith:'@fixture.test'}}]},select:{id:true}});
 await db.userOrganization.createMany({data:users.map(u=>({userId:u.id,organizationId:orgId,roleId:role.id}))});
 const login=await fetch('http://backend:3000/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@demo.com',password:'admin123'})});
 if(!login.ok) throw new Error(`Capacity HTTP login failed ${login.status}`);
 const cookie=login.headers.get('set-cookie')!.split(';')[0];
 const metrics=[];
 const paths=[`/invoices?page=1&limit=50`,`/invoices?page=${Math.floor(orders/50)-1}&limit=50`,'/invoices?page=1&limit=50&search=BENCH-1','/reports/sales?type=by-customer','/reports/sales?type=top-products','/reports/gl?type=trial-balance&asOfDate=2025-12-31','/dashboard/summary'];
 for(const path of paths) {
  const times=[];let bytes=0,status=0;
  for(let i=0;i<6;i++) {const start=performance.now();const response=await fetch(`http://backend:3000/api/v1${path}`,{headers:{cookie,'x-active-org':orgId},signal:AbortSignal.timeout(60000)});const text=await response.text();status=response.status;bytes=Buffer.byteLength(text);if(!response.ok) throw new Error(`${path}: ${status} ${text.slice(0,200)}`);if(i)times.push(performance.now()-start);}
  metrics.push({path,samplesMs:times,p95Ms:Math.max(...times),bytes,status});
 }
 writeFileSync(`/results/http-${orders}.json`,JSON.stringify({orgId,orders,metrics,scope:'Direct production backend HTTP, one warmup plus five samples; HTTPS proxy/browser measured separately'},null,2));
 writeFileSync(`/results/capacity-ready-${orders}.json`,JSON.stringify({orgId,orders}));
 const start=Date.now();
 while(!existsSync(`/results/capacity-release-${orders}.json`)) {if(Date.now()-start>45*60*1000)throw new Error('Timed out awaiting external browser/load measurements');await new Promise(r=>setTimeout(r,1000));}
 console.log(`HTTP/browser/load hook completed for ${orders} orders`);
}
