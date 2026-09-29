import { canSeeOwner, hasIamPermission } from "./auth.js";
import { outboundOrderStatus } from "./outbound-release.js";
import { purchaseInvoicePending } from "./purchase-invoice.js";
import type { SessionUser, Customer, Todo, MonthlySalesRecord, PurchaseOrder, OutboundOrder } from "./types.js";
import type { CrmStore } from "./store.js";

export function workbenchProfile(user: SessionUser) {
  const roles = user.iamRoleNames || [];
  if (user.role === "admin" || roles.some(name => ["公司管理员", "项目负责人", "部门负责人"].includes(name))) return "management";
  if (roles.includes("财务")) return "finance";
  if (roles.includes("采购")) return "procurement";
  if (roles.includes("销售内勤")) return "sales_operations";
  if (roles.includes("销售员")) return "sales";
  if (roles.some(name => ["运营", "助理兼公司行政"].includes(name))) return "oversight";
  return user.role === "manager" ? "management" : "sales";
}

export function availableDashboardBoards(user: SessionUser) {
  const profile = workbenchProfile(user);
  return ["tasks", "customers", "orders", ...(hasIamPermission(user,"purchase.order.read") && !["sales", "sales_operations"].includes(profile) ? ["purchases"] : []), "outbound"];
}

export function buildWorkbenchOverview(user: SessionUser, store: CrmStore, data: {
  customers: Customer[]; todos: Todo[]; sales: MonthlySalesRecord[]; purchases: PurchaseOrder[]; outbound: OutboundOrder[]; scope: string; today: string;
}) {
  const {customers,todos,sales,purchases,outbound,scope,today} = data;
  const profile=workbenchProfile(user), month=today.slice(0,7);
  const metric=(label:string,value:number,unit:string,view:string,hint="")=>({label,value,unit,view,hint});
  const salesFor=(order:OutboundOrder)=>sales.find(s=>s.id===order.salesOrderId);
  const overdue=(value:string)=>Boolean(value && (value.includes("逾期") || Number.isFinite(Date.parse(value)) && Date.parse(value)<Date.now()));
  const overdueCustomers=customers.filter(c=>overdue(c.nextReminder||""));
  const dueCustomers=customers.filter(c=>c.nextReminder?.slice(0,10)===today);
  const pendingApprovals=todos.filter(t=>t.triggerKey?.startsWith("approval-task:"));
  const waitingPayment=outbound.filter(o=>!o.financeConfirmedAt);
  const invoices=sales.filter(s=>s.invoiceRequired && s.invoiceStatus!=="已开票");
  const pendingPurchase=purchases.filter(p=>p.approvalStatus==="待审批");
  const rejectedPurchase=purchases.filter(p=>p.approvalStatus==="已驳回");
  const missingInvoice=purchases.filter(p=>purchaseInvoicePending(p));
  const unlinkedPurchase=purchases.filter(p=>!store.monthlySalesRecords.some(s=>!s.voidedAt&&s.teamId===p.teamId&&s.purchaseOrderId===p.id));
  const waitingOutbound=sales.filter(s=>s.approvalStatus==="已通过"&&!store.outboundOrders.some(o=>!o.voidedAt&&o.teamId===s.teamId&&o.salesOrderId===s.id));
  const rejectedSales=sales.filter(s=>s.approvalStatus==="已驳回");
  const rejectedOutbound=outbound.filter(o=>o.approvalStatus==="已驳回");
  const missingSales=sales.filter(s=>!s.purchaseOrderId || (s.deposit||0)>0&&(!s.depositPaymentAccountId||!s.depositReceiptAttachment?.length));
  const pendingOrders=[...sales,...purchases,...outbound].filter(o=>o.approvalStatus==="待审批");
  const targets=store.monthlySalesTargets.filter(t=>t.month===month&&canSeeOwner(user,t.ownerId,t.teamId));
  const targetAmount=targets.reduce((n,t)=>n+t.targetAmount,0);
  const actualAmount=sales.filter(s=>new Date(s.createdAt).toLocaleDateString("sv-SE",{timeZone:"Asia/Shanghai"}).startsWith(month)).reduce((n,s)=>n+s.salesAmount,0);
  const progress=targetAmount>0?Math.round(actualAmount/targetAmount*1000)/10:0;
  const taskHint=targetAmount>0?`本月完成 ${actualAmount.toFixed(2)} 元 / 目标 ${targetAmount.toFixed(2)} 元`:"尚未设置本月销售目标";
  const labels={sales:"销售工作台",sales_operations:"销售内勤工作台",procurement:"采购工作台",finance:"财务工作台",management:"经营管理工作台",oversight:"协同督办工作台"};
  let title:string=labels[profile],description="",action="",impact="",metrics:ReturnType<typeof metric>[]=[],queueTitle="待处理业务",distributionTitle="业务状态概览";
  type Item={title:string;subtitle:string;view:string};const queue:Item[]=[];
  const add=(rows:Array<{orderNo?:string}>,label:string,view:string)=>{for(const row of rows)queue.push({title:`${label} · ${row.orderNo||"未编号"}`,subtitle:"点击进入对应业务页面处理",view});};
  if(profile==="sales"){
    title=!customers.length?"暂无客户数据":overdueCustomers.length?`优先跟进 ${overdueCustomers.length} 位逾期客户`:"销售跟进与订单安排";
    description=!customers.length?"可先新增或导入客户，再安排跟进。":"根据本人客户、订单与月度任务安排今天的工作。";
    action="先处理逾期客户和被驳回订单，再推进意向客户；沟通后登记跟进结果。";impact="完成跟进、销售订单和新增客户任务，推进本人月度目标。";
    metrics=[metric("逾期客户",overdueCustomers.length,"位","customers"),metric("今日应跟进",dueCustomers.length,"位","customers"),metric("待处理订单",sales.filter(s=>["草稿","已驳回"].includes(s.approvalStatus||"")).length+rejectedOutbound.length,"张","sales-orders"),metric("月度任务进度",progress,"%","data-dashboard",taskHint)];
    queueTitle="跟进优先级队列";distributionTitle="客户状态概览";
  }else if(profile==="procurement"){
    description="查看本人采购及其关联销售、出库的进度，优先补齐采购资料。";action="先修改被驳回采购单，补齐发票，再跟进采购审批和销售关联。";impact="采购审批完成后，关联销售单才可审批通过。";
    metrics=[metric("待审批采购",pendingPurchase.length,"张","purchase-orders"),metric("被驳回采购",rejectedPurchase.length,"张","purchase-orders"),metric("待补发票",missingInvoice.length,"张","purchase-orders"),metric("待关联销售",unlinkedPurchase.length,"张","purchase-orders")];
    queueTitle="采购处理队列";distributionTitle="采购状态概览";add(rejectedPurchase,"采购已驳回","purchase-orders");add(missingInvoice,"补充发票","purchase-orders");add(unlinkedPurchase,"关联销售单","purchase-orders");add(pendingPurchase,"跟进审批","purchase-orders");
  }else if(profile==="finance"){
    description="核对实际到账、登记开票，处理分配给本人的审批。";action="先核实银行到账记录，再确认收款；需要开票的销售单及时登记发票进度。";impact="登记金额不代表到账；财务确认后出库单才能进入后续审批。";
    metrics=[metric("待确认收款",waitingPayment.length,"张","outbound-orders"),metric("待开票销售单",invoices.length,"张","sales-orders"),metric("本人待审批",pendingApprovals.length,"项","approval-center"),metric("逾期财务待办",todos.filter(t=>overdue(t.dueAt)&&/outbound-payment:|sales-order-finance:|purchase-invoice:|approval-task:/.test(t.triggerKey||"")).length,"项","dashboard")];
    queueTitle="财务处理队列";distributionTitle="收款与开票概览";add(waitingPayment,"核实尾款到账","outbound-orders");add(invoices,"处理销售开票","sales-orders");
  }else if(profile==="sales_operations"){
    description="安排本人相关订单出库，补齐资料并跟进审批进度。";action="先处理被驳回订单，补齐资料，再为已审批销售单安排出库。";impact="及时完成订单协同，避免订单停留在资料缺失或待出库环节。";
    metrics=[metric("待出库",waitingOutbound.length,"张","outbound-orders"),metric("资料待补",missingSales.length,"张","sales-orders"),metric("被驳回订单",rejectedSales.length+rejectedOutbound.length,"张","sales-orders"),metric("审批中订单",pendingOrders.length,"张","sales-orders")];
    queueTitle="销售内勤处理队列";distributionTitle="订单协同概览";add(rejectedSales,"销售已驳回","sales-orders");add(rejectedOutbound,"出库已驳回","outbound-orders");add(missingSales,"补齐销售资料","sales-orders");add(waitingOutbound,"安排出库","outbound-orders");
  }else{
    description=`查看${scope}的经营进度与积压环节；下方待办、审批仍只属于本人。`;action="优先督办积压审批、收款确认和待出库订单，再查看各销售员月度任务差距。";impact="可以查看授权范围内的进度，审批操作仍由流程指定人员处理。";
    metrics=profile==="management"?[metric("待审批订单",pendingOrders.length,"张","data-dashboard:orders"),metric("待财务确认",waitingPayment.length,"张","outbound-orders"),metric("待出库",waitingOutbound.length,"张","outbound-orders"),metric("月度任务完成率",progress,"%","data-dashboard",taskHint)]:[metric("今日新增客户",customers.filter(c=>new Date(c.createdAt || "").toLocaleDateString("sv-SE",{timeZone:"Asia/Shanghai"})===today).length,"位","customers"),metric("逾期待跟进客户",overdueCustomers.length,"位","customers"),metric("待推进订单",pendingOrders.length+waitingOutbound.length,"张","data-dashboard"),metric("本人逾期待办",todos.filter(t=>overdue(t.dueAt)).length,"项","dashboard")];
    queueTitle="业务督办队列";distributionTitle="订单进度概览";add(waitingPayment,"待财务确认","outbound-orders");add(waitingOutbound,"待出库","outbound-orders");add(pendingPurchase,"采购待审批","purchase-orders");add(sales.filter(s=>s.approvalStatus==="待审批"),"销售待审批","sales-orders");add(outbound.filter(o=>o.approvalStatus==="待审批"),"出库待审批","outbound-orders");
  }
  const distribution=profile==="procurement"?[{label:"采购待审批",count:pendingPurchase.length},{label:"采购被驳回",count:rejectedPurchase.length},{label:"待补发票",count:missingInvoice.length},{label:"待关联销售",count:unlinkedPurchase.length}]:profile==="finance"?[{label:"待财务确认",count:waitingPayment.length},{label:"已确认收款",count:outbound.filter(o=>Boolean(o.financeConfirmedAt)).length},{label:"待开票",count:invoices.length},{label:"已开票",count:sales.filter(s=>s.invoiceRequired&&s.invoiceStatus==="已开票").length}]:[{label:"销售待审批",count:sales.filter(s=>s.approvalStatus==="待审批").length},{label:"待出库",count:waitingOutbound.length},{label:"出库待审批",count:outbound.filter(o=>o.approvalStatus==="待审批").length},{label:"已完结",count:outbound.filter(o=>outboundOrderStatus(o,salesFor(o))==="已完结").length}];
  return {profile,label:labels[profile],title,description,action,impact,basis:`根据${scope}的 ${sales.length} 张销售单、${purchases.length} 张采购单、${outbound.length} 张出库单，以及本人 ${todos.length} 项未完成待办统计。`,metrics,queueTitle,queue:queue.slice(0,8),distributionTitle,distribution};
}
