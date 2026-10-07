import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { writeFileSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { bootstrapOrganization } from '../lib/organization/bootstrap';
import { receiveBatch } from '../lib/pos/batch-stock-in';
const url=process.env.DATABASE_URL!;
if(!url || !new URL(url).pathname.endsWith('_capacity_test')) throw new Error('Disposable _capacity_test database required');
const db=new PrismaClient();
try {
 if(process.argv[2]==='verify') {
  const fixture=JSON.parse(readFileSync('/results/load-fixture.json','utf8'));
  const orgId=fixture.orgId;
  const unbalanced=await db.$queryRaw<any[]>(Prisma.sql`SELECT e.id, SUM(l.debit)-SUM(l.credit) AS difference FROM "JournalEntry" e JOIN "JournalLine" l ON l."entryId"=e.id WHERE e."organizationId"=${orgId} AND e.status='POSTED' GROUP BY e.id HAVING ABS(SUM(l.debit)-SUM(l.credit))>0.005`);
  const settlements=await db.$queryRaw<any[]>(Prisma.sql`SELECT i.id,i.status,i."totalAmount",COALESCE(SUM(a."amountApplied"),0) AS paid FROM "SalesInvoice" i JOIN "ARPaymentAllocation" a ON a."invoiceId"=i.id JOIN "ARPayment" p ON p.id=a."paymentId" AND p.status='COMPLETED' WHERE i."organizationId"=${orgId} GROUP BY i.id HAVING ABS(i."totalAmount"-SUM(a."amountApplied"))>0.005 OR i.status<>'PAID'`);
  const apSettlements=await db.$queryRaw<any[]>(Prisma.sql`SELECT b.id,b.status,b."totalAmount",SUM(a."amountApplied") AS paid FROM "Bill" b JOIN "APPaymentAllocation" a ON a."billId"=b.id JOIN "APPayment" p ON p.id=a."paymentId" AND p.status='COMPLETED' WHERE b."organizationId"=${orgId} GROUP BY b.id HAVING ABS(b."totalAmount"-SUM(a."amountApplied"))>0.005 OR b.status<>'PAID'`);
  const stock=[];
  for(const w of fixture.workers) {
   const count=await db.posSale.count({where:{organizationId:orgId,shiftId:w.shiftId}});
   const batch=await db.stockBatch.findFirstOrThrow({where:{organizationId:orgId,itemId:w.itemId}});
   const ledger=await db.inventoryLedgerEntry.aggregate({where:{organizationId:orgId,itemId:w.itemId},_sum:{qtyIn:true,qtyOut:true,valueChange:true}});
   const remaining=100000-count;
   stock.push({worker:w.index,sales:count,batch:Number(batch.qtyOnHand),ledger:Number(ledger._sum.qtyIn)-Number(ledger._sum.qtyOut),remaining,value:Number(ledger._sum.valueChange),pass:Number(batch.qtyOnHand)===remaining && Number(ledger._sum.qtyIn)-Number(ledger._sum.qtyOut)===remaining && Number(ledger._sum.valueChange)===remaining*1000});
  }
  const approvals=await db.approvalRequest.groupBy({by:['status'],where:{organizationId:orgId},_count:true});
  const completedCounts={invoices:await db.salesInvoice.count({where:{organizationId:orgId,number:{startsWith:'LOAD-'},status:'PAID'}}),bills:await db.bill.count({where:{organizationId:orgId,status:'PAID'}}),posSales:await db.posSale.count({where:{organizationId:orgId}}),journals:await db.journalEntry.count({where:{organizationId:orgId,status:'POSTED'}})};
  const pendingInvoices=await db.salesInvoice.count({where:{organizationId:orgId,number:{startsWith:'LOAD-'},status:{not:'PAID'}}});
  const balances=await db.$queryRaw<any[]>(Prisma.sql`SELECT a.code,COALESCE(SUM(l.debit-l.credit) FILTER (WHERE e.id IS NOT NULL),0) AS net FROM "Account" a LEFT JOIN "JournalLine" l ON l."accountId"=a.id LEFT JOIN "JournalEntry" e ON e.id=l."entryId" AND e.status='POSTED' WHERE a."organizationId"=${orgId} AND a.code IN ('1-1000','1-1200','2-1000','1-1300') GROUP BY a.code`);
  const net=Object.fromEntries(balances.map(b=>[b.code,Number(b.net)]));
  const expectedCash=completedCounts.posSales*2000+completedCounts.invoices*1000-completedCounts.bills*1000;
  const expectedInventory=stock.reduce((sum,s)=>sum+s.remaining*1000,0);
  const arOpen=await db.salesInvoice.aggregate({where:{organizationId:orgId,number:{startsWith:'LOAD-'},status:{in:['SENT','OVERDUE']}},_sum:{totalAmount:true}});
  const apOpen=await db.bill.aggregate({where:{organizationId:orgId,status:{in:['OPEN','OVERDUE']}},_sum:{totalAmount:true}});
  const expectedAr=Number(arOpen._sum.totalAmount??0),expectedAp=-Number(apOpen._sum.totalAmount??0);
  const controls={balances:net,expectedCash,expectedInventory,expectedAr,expectedAp,passed:Math.abs(net['1-1000']-expectedCash)<0.005&&Math.abs(net['1-1200']-expectedAr)<0.005&&Math.abs(net['2-1000']-expectedAp)<0.005&&Math.abs(net['1-1300']-expectedInventory)<0.005};
  const accountingIntegrityPassed=!unbalanced.length&&!settlements.length&&!apSettlements.length&&stock.every(s=>s.pass)&&controls.passed;
  const workflowCompletionPassed=!pendingInvoices&&expectedAp===0;
  const out={unbalancedJournals:unbalanced.length,invalidArSettlements:settlements.length,invalidApSettlements:apSettlements.length,pendingInvoices,stock,approvals,completedCounts,controls,accountingIntegrityPassed,workflowCompletionPassed,passed:accountingIntegrityPassed&&workflowCompletionPassed};
  writeFileSync('/results/invariants.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
  assert.equal(out.accountingIntegrityPassed,true,'Accounting integrity verification failed');
 } else {
  const admin=await db.user.findUniqueOrThrow({where:{email:'admin@demo.com'}});
  const {orgId}=await db.$transaction(tx=>bootstrapOrganization(tx,{legalName:'Performance load company',displayName:'Performance load company',fiscalYearStart:new Date('2026-01-01')},admin.id),{timeout:30000});
  await db.organization.update({where:{id:orgId},data:{costingMethod:'FIFO',taxEnabled:false,enforceCreditLimit:false,requireDistinctApproverForAdmins:true}});
  await db.customer.create({data:{organizationId:orgId,code:'WALK-IN',name:'Walk-in'}});
  const role=await db.role.findFirstOrThrow({where:{organizationId:orgId,roleType:'ADMIN'}});
  const warehouse=await db.warehouse.findFirstOrThrow({where:{organizationId:orgId}});
  const cash=await db.account.findFirstOrThrow({where:{organizationId:orgId,code:'1-1000'}});
  const expense=await db.account.findFirstOrThrow({where:{organizationId:orgId,code:'5-1100'}});
  const hash=await bcrypt.hash('PerformanceOnly123!',10);
  const workers=[];
  for(let index=0;index<20;index++) {
   const user=await db.user.create({data:{email:`load-${index}@fixture.test`,fullName:`Load user ${index}`,passwordHash:hash,memberships:{create:{organizationId:orgId,roleId:role.id}}}});
   const customer=await db.customer.create({data:{organizationId:orgId,code:`LOAD-${index}`,name:`Load customer ${index}`}});
   const vendor=await db.vendor.create({data:{organizationId:orgId,code:`LOAD-${index}`,name:`Load vendor ${index}`}});
   const item=await db.item.create({data:{organizationId:orgId,sku:`LOAD-${index}`,name:`Load stock ${index}`,type:'PRODUCT',sellingPrice:2000,costPrice:1000,requiresBatchTracking:true}});
   const register=await db.posRegister.create({data:{organizationId:orgId,code:`LOAD-${index}`,name:`Load register ${index}`,warehouseId:warehouse.id,cashAccountId:cash.id}});
   const shift=await db.posShift.create({data:{organizationId:orgId,registerId:register.id,cashierId:user.id,status:'OPEN',openingFloat:0}});
   await db.$transaction(tx=>receiveBatch(tx,orgId,{itemId:item.id,warehouseId:warehouse.id,batchNumber:`LOAD-${index}`,expiryDate:new Date('2028-01-01'),qty:100000,unitCost:1000,date:new Date('2026-10-06')}),{timeout:30000});
   workers.push({index,userId:user.id,email:user.email,customerId:customer.id,vendorId:vendor.id,itemId:item.id,registerId:register.id,shiftId:shift.id});
  }
  writeFileSync('/results/load-fixture.json',JSON.stringify({orgId,cashAccountId:cash.id,expenseAccountId:expense.id,workers},null,2));
  console.log('Created 20 independent authenticated load fixtures');
 }
} finally {await db.$disconnect();}
