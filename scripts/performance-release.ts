import {PrismaClient} from '@prisma/client';
const url=process.env.DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_capacity_test'))throw new Error('Disposable test database required');
const db=new PrismaClient();
try {const org=await db.organization.findUniqueOrThrow({where:{id:process.argv[2]}});if(org.legalName!=='Capacity benchmark fixture')throw new Error('Not a capacity fixture');await db.userOrganization.deleteMany({where:{organizationId:org.id}});}finally{await db.$disconnect();}
