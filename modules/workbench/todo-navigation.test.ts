import assert from "node:assert/strict";
import { todoNavigation } from "./todo-navigation.js";
for(const [key,view,kind,id] of [
  ["approval-task:task-1","approval-center","approval","task-1"],
  ["purchase-invoice:purchase-1","purchase-orders","invoice","purchase-1"],
  ["sales-order-finance:sale-1","sales-orders","finance","sale-1"],
  ["sales-order-procurement:sale-1","sales-orders","sales","sale-1"],
  ["morning-meeting:meeting-1:task-2","morning-meetings","meeting","meeting-1"],
  ["monthly-customer-target:2026-09:user-1","data-dashboard","target","2026-09"],
  ["monthly-sales-target:2026-09:user-1","data-dashboard","target","2026-09"],
  ["customer-reminder:customer-1","customers","customer","customer-1"]]) {
  const target=todoNavigation({triggerKey:key});assert.equal(target?.view,view);assert.equal(target?.kind,kind);assert.equal(target?.id,id);
}
assert.equal(todoNavigation({customerId:"customer-1"})?.id,"customer-1");
assert.equal(todoNavigation({triggerKey:"manual"}),null);
assert.equal(todoNavigation({triggerKey:"approval-task:"}),null);
console.log("待办关联映射测试通过：审批、订单、补票、会议、月度任务、客户与未关联待办");
