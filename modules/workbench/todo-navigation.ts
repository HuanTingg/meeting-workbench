export function todoNavigation(todo: { triggerKey?: string; customerId?: string }) {
  const key = todo.triggerKey || "";
  const targets = [
    ["outbound-payment:", "outbound-orders", "outbound-payment", "确认尾款到账"],
    ["approval-task:", "approval-center", "approval", "去审批"],
    ["purchase-invoice:", "purchase-orders", "invoice", "补充发票资料"],
    ["sales-order-procurement:", "sales-orders", "sales", "查看销售订单"],
    ["sales-order-finance:", "sales-orders", "finance", "处理订单收款"],
    ["morning-meeting:", "morning-meetings", "meeting", "查看会议任务"],
    ["monthly-sales-target:", "data-dashboard", "target", "查看任务进度"],
    ["monthly-customer-target:", "data-dashboard", "target", "查看任务进度"]
  ];
  for (const [prefix, view, kind, label] of targets) {
    if (key.startsWith(prefix) && key.slice(prefix.length)) return { view, kind, label, id: key.slice(prefix.length).split(":")[0] };
  }
  const customerId = todo.customerId || (key.startsWith("customer-reminder:") ? key.slice("customer-reminder:".length) : "");
  return customerId ? { view: "customers", kind: "customer", label: "跟进客户", id: customerId } : null;
}
