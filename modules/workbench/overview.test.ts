import assert from "node:assert/strict";
import type { MonthlySalesRecord, PurchaseOrder, OutboundOrder, Customer, Todo } from "./types.js";
assert.equal(process.env.NODE_ENV,"test");assert.equal(process.env.CRM_STORE,"memory");
const {app}=await import("./server.js"),{getStore}=await import("./store.js"),{signToken}=await import("./auth.js");
const store=getStore(),admin=store.users.find(u=>u.role==="admin")!;
const makeUser=(id:string,name:string)=>({...admin,id,name,role:"sales" as const});
const seller=makeUser("wb-seller","销售员"),procurement=makeUser("wb-purchase","采购"),finance=makeUser("wb-finance","财务"),operations=makeUser("wb-sales-ops","销售内勤"),lead=makeUser("wb-lead","项目负责人"),oversight=makeUser("wb-oversight","运营");
store.users.push(seller,procurement,finance,operations,lead,oversight);store.persist=async()=>{};
store.monthlySalesTargets=[];store.customers=[];store.monthlySalesRecords=[];store.purchaseOrders=[];store.outboundOrders=[];store.todos=[];
store.getIamCapabilitySnapshot=async user=>{
 const all=[admin.id,finance.id,lead.id,oversight.id].includes(user.id),scope=all?"tenant":"self";
 return {schemaVersion:"test",tenantId:user.teamId,membershipId:user.id,revision:"test",source:"iam",permissions:{"workspace.dashboard.read":[scope],"customer.read":["tenant"],"order.read":[scope],"shipment.read":[scope],...(![seller.id,operations.id].includes(user.id)?{"purchase.order.read":[scope]}:{})},roleNames:[user.id===admin.id?"公司管理员":store.users.find(u=>u.id===user.id)!.name],generatedAt:new Date().toISOString()} as any;
};
const now=new Date().toISOString(),month=now.slice(0,7),teamId=admin.teamId;
store.customers.push({id:"wb-customer",teamId,ownerId:seller.id,company:"本人客户",nextReminder:"",lifecycleStatus:"open",health:80,amount:0,contact:"",stage:"询盘",country:"郑州",createdAt:now} as Customer);
const purchase={id:"wb-p",orderNo:"CG-WB",teamId,purchaserId:procurement.id,purchaserName:procurement.name,purchaseDate:now.slice(0,10),productName:"牛肉",quantity:1,weight:100,totalAmount:1000,invoiceType:"不开票",approvalStatus:"待审批",createdAt:now,updatedAt:now} as PurchaseOrder;
store.purchaseOrders.push(purchase);
const sale={id:"wb-s",orderNo:"XS-WB",sourceType:"manual",teamId,ownerId:seller.id,customerName:"本人客户",customerId:"wb-customer",purchaseOrderId:purchase.id,approvalStatus:"已通过",salesAmount:1000,deposit:100,invoiceRequired:true,invoiceStatus:"未开票",month,quantity:1,weight:100,createdAt:now,updatedAt:now} as MonthlySalesRecord;
store.monthlySalesRecords.push(sale,{...sale,id:"wb-unrelated",orderNo:"XS-OTHER",ownerId:operations.id,purchaseOrderId:"",invoiceRequired:false}, {...sale,id:"wb-foreign",teamId:"other-company",salesAmount:999999});
store.outboundOrders.push({id:"wb-o",orderNo:"CK-WB",teamId,ownerId:seller.id,salesOrderId:sale.id,approvalStatus:"草稿",actualReceivedAmount:900,outboundDate:now.slice(0,10),driverName:"司机",updatedAt:now,createdAt:now} as OutboundOrder);
store.todos.push({id:"wb-t",title:"财务待审批",ownerId:finance.id,teamId,done:false,status:"pending",type:"other",priority:"high",dueAt:now,related:"",triggerKey:"approval-task:wb",createdAt:now} as Todo);
const server=app.listen(0),address=server.address();if(!address||typeof address==="string")throw Error("No server");
let checks=0;
async function summary(user:typeof admin){const r=await fetch(`http://127.0.0.1:${address.port}/api/dashboard/summary?view=workbench`,{headers:{Authorization:`Bearer ${signToken(user)}`}});const data=await r.json() as any;assert.equal(r.status,200,JSON.stringify(data));checks++;return data;}
try{
 const s=await summary(seller);assert.equal(s.workbench.profile,"sales");assert.ok(!s.availableBoards.includes("purchases"));assert.equal(s.orderWorkflow.total,1);assert.equal(s.metrics.todos,0);assert.equal(s.metrics.customers,1);
 const p=await summary(procurement);assert.equal(p.workbench.profile,"procurement");assert.ok(p.availableBoards.includes("purchases"));assert.equal(p.orderWorkflow.total,1,"采购工作台包含本人采购关联的销售单");assert.equal(p.workbench.metrics[0].value,1);
 const f=await summary(finance);assert.equal(f.workbench.profile,"finance");assert.equal(f.workbench.metrics[0].value,1);assert.equal(f.workbench.metrics[1].value,1);assert.equal(f.workbench.metrics[2].value,1);assert.equal(f.orderWorkflow.total,2,"不包含其他公司的订单");
 const o=await summary(operations);assert.equal(o.workbench.profile,"sales_operations");assert.ok(!o.availableBoards.includes("purchases"));assert.equal(o.orderWorkflow.total,1);
 const m=await summary(lead);assert.equal(m.workbench.profile,"management");assert.equal(m.orderWorkflow.total,2);assert.equal(m.metrics.todos,0,"负责人不能把他人待办列为本人待办");assert.equal(m.scopeLabels.todos,"本人待办");
 assert.equal((await summary(admin)).workbench.profile,"management");assert.equal((await summary(oversight)).workbench.profile,"oversight");
 store.customers=[];store.monthlySalesRecords=[];store.purchaseOrders=[];store.outboundOrders=[];store.todos=[];
 const empty=await summary(seller);assert.equal(empty.workbench.title,"暂无客户数据");assert.equal(empty.metrics.todos,0);assert.equal(empty.orderWorkflow.total,0);
 console.log(JSON.stringify({ok:true,httpChecks:checks,roles:7,scopeIsolation:true,ownTodosOnly:true,purchaseTabHiddenForSales:true,emptyState:true}));
}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
