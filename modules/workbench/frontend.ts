
type DashboardPeriod = "today" | "week" | "month" | "custom";


let dashboardLeadFunnelChart: ReturnType<typeof echarts.init> | null = null;

let dashboardLeadFunnelResizeObserver: ResizeObserver | null = null;

let dashboardRefreshPromise: Promise<void> | null = null;

let activeDashboardBoard: "tasks" | "customers" | "orders" | "purchases" | "outbound" = "tasks";

let dashboardDataBoardCharts: ReturnType<typeof echarts.init>[] = [];

let dashboardDataBoardResizeObserver: ResizeObserver | null = null;

let dashboardBoardStartDate = chinaToday();

let dashboardBoardEndDate = chinaToday();

let dashboardBoardUpdatedText = "数据加载中";

const DASHBOARD_LIVE_REFRESH_MS = 10_000;


interface Todo {
  id: string;
  title: string;
  type: string;
  priority: string;
  status?: string;
  pinState?: string;
  sortOrder?: number;
  dueAt: string;
  related: string;
  done: boolean;
  impactAmount?: number;
  createdAt?: string;
  historyAt?: string;
  customerId?: string;
  dealId?: string;
  reminderRuleId?: string;
  triggerKey?: string;
  snoozedFrom?: string;
  snoozeReason?: string;
  snoozeCount?: number;
  snoozedBy?: string;
  completedAt?: string;
  completedBy?: string;
  completionResult?: string;
  leadId?: string;
  prospectCandidateId?: string;
  tenantProspectId?: string;
  outreachChannel?: ProspectOutreachChannel;
  touchpointId?: string;
  cancelledAt?: string;
  cancellationReason?: string;
}


interface WorkbenchOverview {
  profile: string; label: string; title: string; description: string; basis: string; action: string; impact: string;
  metrics: Array<{label:string;value:number;unit:string;view:string;hint:string}>;
  queueTitle:string; queue:Array<{title:string;subtitle:string;view:string}>;
  distributionTitle:string; distribution:Array<{label:string;count:number}>;
}

interface DashboardSummary {
  workbench?: WorkbenchOverview;
  availableBoards?: string[];
  scope: string;
  scopeLabels: {
    business: string;
    todos: string;
  };
  updatedAt: string;
  orderWorkflow: {
    total: number;
    counts: Array<{ stage: string; count: number }>;
    rows: Array<{ id: string; salesOrderNo: string; purchaseOrderNo: string; outboundOrderNo: string; customer: string; owner: string; amount: number; stage: string; approvalInstanceId: string; updatedAt: string }>;
  };
  dataBoards: Record<DashboardPeriod, {
    label: string; start: string; end: string;
    taskAchievement: {
      month: string;
      rows: Array<{ key: string; label: string; unit: string; target: number; completed: number; remaining: number; projected: number; progress: number; status: string }>;
      actuals: { salespeople: number; targetAmount: number; completedAmount: number; overallProgress: number };
      customerRows: Array<{ ownerId: string; label: string;  target: number; completed: number; manual: number; imported: number; remaining: number; progress: number; plannedDays: number; elapsedDays: number; remainingDays: number; projected: number; canProject: boolean; dailyAverage: number; requiredDaily: number | null; status: string }>;
    };
    customers: {
      totals: { added: number; imported: number; followUps: number; salesAmount: number };
      rows: Array<{ ownerId: string; owner: string; imported: number; manual: number; followUps: number; open: number; intent: number; won: number; salesOrders: number; salesAmount: number }>;
    };
    orders: DashboardSummary["orderWorkflow"];
    purchases: {
      totals: { orders: number; quantity: number; weight: number; amount: number };
      rows: Array<{ purchaserId: string; purchaser: string; orders: number; quantity: number; weight: number; amount: number; products: string }>;
      products: Array<{ product: string; orders: number; quantity: number; weight: number; amount: number }>;
    };
    outbound: {
      totals: { orders: number; transit: number; received: number; receivedAmount: number };
      rows: Array<{ ownerId: string; owner: string; orders: number; pending: number; transit: number; received: number; weight: number; salesAmount: number; receivedAmount: number }>;
    };
  }>;
  periods: Record<DashboardPeriod, {
    label: string;
    start: string;
    end: string;
    expectedDeals: number;
    expectedAmounts: Array<{ currency: string; amount: number }>;
    pendingTodos: number;
    highPriorityTodos: number;
    newLeads: number;
    briefing: {
      title: string;
      description: string;
      basis: string;
      action: string;
      impact: string;
    };
  }>;
  briefing: {
    title: string;
    description: string;
    basis: string;
    action: string;
    impact: string;
    riskAmount: number;
    riskLabel: string;
    closableDeals: number;
    closableAmount: number;
    unreadWecom: number;
  };
  metrics: {
    customers: number;
    riskCustomers: number;
    todos: number;
    overdueTodos: number;
    forecastAmount: number;
    wecomBoundRate: number;
    pendingKnowledge: number;
    examPassRate: number;
    unfinishedExams: number;
    customerCompleteness: number;
  };
  schedule: Array<{ time: string; title: string; subtitle: string; tone: string }>;
  quality: {
    followHealth: number;
    overdueRate: number;
    avgResponseHours: number;
  };
  leadFunnel: {
    stages: Array<{ key: string; label: string; count: number; conversionRate: number }>;
    todayAdded: number;
    filteredOut: number;
    dealConversionRate: number;
  };
  pipelineHealth: Array<{ stage: string; count: number; amount: number; riskCount: number; width: number; tone: string }>;
  todoInsights: {
    total: number;
    overdue: number;
    completionRate: number;
    impactAmount: number;
    typeRows: Array<{ type: string; label: string; count: number; risk: string }>;
    weekLoad: Array<{ day: string; count: number }>;
    historyCount: number;
    historyAmount: number;
  };
  priorityTasks: Array<{ id: string; customerId: string; title: string; subtitle: string; score: number; reason: string; action: string; tone: string; badge: string }>;
}


function parseTodoDate(value: string) {
  const text = value.trim();
  const exact = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}))?/);
  if (exact) {
    const [, year, month, day, hour = "0", minute = "0"] = exact;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  }
  const base = todayStart();
  if (/^(\d{1,2}):(\d{2})$/.test(text) || text.includes("今天")) return base;
  if (text.includes("昨天")) return new Date(base.getTime() - 86400000);
  if (text.includes("前天")) return new Date(base.getTime() - 86400000 * 2);
  if (text.includes("明天")) return new Date(base.getTime() + 86400000);
  return null;
}


function isHistoricalTodo(todo: Todo) {
  return Boolean(todo.historyAt);
}


function todoCreatedTime(todo: Todo, fallbackIndex = 0) {
  if (todo.createdAt) {
    const parsed = new Date(todo.createdAt).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  const idTime = todo.id.match(/^t_(\d{10,})$/);
  if (idTime) return Number(idTime[1]);
  const due = parseTodoDate(todo.dueAt)?.getTime();
  if (due && Number.isFinite(due)) return due;
  return -fallbackIndex;
}


function sortTodos(todos: Todo[]) {
  return todos
    .map((todo, index) => ({ todo, index }))
    .sort((left, right) => {
      if (left.todo.done !== right.todo.done) return left.todo.done ? 1 : -1;
      const leftOrder = typeof left.todo.sortOrder === "number" ? left.todo.sortOrder : 0;
      const rightOrder = typeof right.todo.sortOrder === "number" ? right.todo.sortOrder : 0;
      if (leftOrder || rightOrder) return leftOrder - rightOrder || todoCreatedTime(right.todo, right.index) - todoCreatedTime(left.todo, left.index);
      return todoCreatedTime(right.todo, right.index) - todoCreatedTime(left.todo, left.index);
    })
    .map((item) => item.todo);
}


function activeTodos(todos: Todo[]) {
  return sortTodos(todos.filter((todo) => !isHistoricalTodo(todo)));
}


function historyTodos(todos: Todo[]) {
  return sortTodos(todos.filter(isHistoricalTodo));
}


function todoTypeText(type: string) {
  const map: Record<string, string> = {
    customer: "客户跟进",
    knowledge: "资料维护",
    exam: "在线考试",
    ocr: "资料识别",
    other: "其它"
  };
  return map[type] || "其它";
}

type OrderDashboardMode = "purchase" | "sales" | "outbound";

let activeOrderDashboard: OrderDashboardMode = "sales";


function activeDashboardTaskMonth() {
  return (dashboardBoardEndDate || chinaToday()).slice(0, 7);
}


async function loadDashboardTaskImportAccess() {
  try {
    const result = await api<{ canManage: boolean; members: Array<{ id: string; name: string; account: string; role: string }> }>(`/api/sales-orders/monthly-targets?month=${encodeURIComponent(activeDashboardTaskMonth())}`);
    monthlySalesTargetCanManage = result.canManage;
    monthlySalesTargetMembers = result.members || [];
    const actions = qs<HTMLElement>("#dashboardTaskManagerActions"); if (actions) actions.hidden = !result.canManage;
  } catch { const actions = qs<HTMLElement>("#dashboardTaskManagerActions"); if (actions) actions.hidden = true; }
}


async function applyOrderDashboard(mode: OrderDashboardMode) {
  activeOrderDashboard = (["purchase", "sales", "outbound"] as OrderDashboardMode[]).includes(mode) ? mode : "sales";
  qsa<HTMLButtonElement>("[data-order-dashboard]").forEach((button) => button.classList.toggle("active", button.dataset.orderDashboard === activeOrderDashboard));
  if (activeOrderDashboard === "purchase") await loadPurchaseOrders();
  if (activeOrderDashboard === "outbound") await loadOutboundOrders();
  renderSalesOrderOverview();
}


function dashboardCacheKey(user: User) {
  return `岗位工作台-v4:${user.id}:${user.role}:${user.teamId}`;
}


function readDashboardCache(user: User) {
  try {
    const raw = localStorage.getItem(storage.dashboardCache);
    if (!raw) return null;
    const cache = JSON.parse(raw) as Record<string, { summary: DashboardSummary; todos: Todo[]; customers: Customer[]; cachedAt: string }>;
    const item = cache[dashboardCacheKey(user)];
    if (!item) return null;
    const age = Date.now() - new Date(item.cachedAt).getTime();
    return age < 5 * 60 * 1000 ? item : null;
  } catch {
    return null;
  }
}


function writeDashboardCache(user: User, summary: DashboardSummary, todos: Todo[], customers: Customer[]) {
  try {
    const raw = localStorage.getItem(storage.dashboardCache);
    const cache = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    cache[dashboardCacheKey(user)] = { summary, todos, customers, cachedAt: new Date().toISOString() };
    localStorage.setItem(storage.dashboardCache, JSON.stringify(cache));
  } catch {
    // Cache is an optimization; rendering must not depend on it.
  }
}


function renderDashboardCache(user: User) {
  const cached = readDashboardCache(user);
  if (!cached) return;
  state.summary = cached.summary;
  state.todos = cached.todos;
  state.customers = cached.customers;
  renderDashboard(cached.summary, cached.todos, cached.customers, true);
  renderTopbarStats();
}


async function refreshDashboardOnly() {
  const user = state.user;
  if (!user) return;
  if (dashboardRefreshPromise) return dashboardRefreshPromise;
  dashboardRefreshPromise = (async () => {
    const summaryUrl = qs<HTMLElement>(".view.active")?.id !== "data-dashboard" ? "/api/dashboard/summary?view=workbench" : state.dashboardPeriod === "custom"
      ? `/api/dashboard/summary?start=${encodeURIComponent(dashboardBoardStartDate)}&end=${encodeURIComponent(dashboardBoardEndDate)}`
      : "/api/dashboard/summary";
    const [summary, todos, customers] = await Promise.all([
      api<DashboardSummary>(summaryUrl),
      api<{ todos: Todo[] }>("/api/todos"),
      api<{ customers: Customer[] }>("/api/customers")
    ]);
    if (state.user?.id !== user.id) return;
    state.summary = summary;
    state.todos = todos.todos;
    state.customers = customers.customers;
    writeDashboardCache(user, summary, todos.todos, customers.customers);
    renderDashboard(summary, todos.todos, customers.customers);
    renderTopbarStats();
  })();
  try {
    await dashboardRefreshPromise;
  } finally {
    dashboardRefreshPromise = null;
  }
}


function requestDashboardRefresh() {
  void refreshDashboardOnly().catch(() => {
    // Background refresh failures should not interrupt the current workflow.
  });
}


function refreshVisibleDashboard() {
  if (!state.user || document.visibilityState !== "visible") return;
  if (!["dashboard", "data-dashboard"].includes(qs<HTMLElement>(".view.active")?.id || "")) return;
  requestDashboardRefresh();
}


function renderDashboard(summary: DashboardSummary, todos: Todo[], customers: Customer[], fromCache = false) {
  // Customer archives are shared, but workbench follow-up prompts belong to this employee.
  if (["sales", "sales_operations"].includes(summary.workbench?.profile || "sales")) customers = customers.filter(customer => customer.ownerId === state.user?.id);
  const businessScopes = state.iamCapabilities?.permissions["workspace.dashboard.read"] || [];
  const roleBusinessScope = businessScopes.includes("tenant") ? "全公司业务"
    : businessScopes.includes("org_subtree") || businessScopes.includes("org_unit") ? "组织业务" : "本人业务";
  const scopeLabels = summary.scopeLabels || {
    business: roleBusinessScope,
    todos: "本人待办"
  };
  qs("#scopeText")!.textContent = summary.scope;
  qs<HTMLElement>("#businessScopeTag")!.textContent = scopeLabels.business;
  qs<HTMLElement>("#todoScopeTag")!.textContent = scopeLabels.todos;
  qsa<HTMLElement>("[data-business-scope]").forEach((node) => {
    node.textContent = scopeLabels.business;
  });
  const period = summary.periods?.[state.dashboardPeriod] || {
    label: "今日",
    start: summary.updatedAt.slice(0, 10),
    end: summary.updatedAt.slice(0, 10),
    expectedDeals: summary.briefing.closableDeals,
    expectedAmounts: [{ currency: "CNY", amount: summary.briefing.closableAmount }],
    pendingTodos: summary.metrics.todos,
    highPriorityTodos: summary.metrics.overdueTodos,
    newLeads: summary.leadFunnel.todayAdded,
    briefing: {
      title: summary.briefing.title,
      description: summary.briefing.description,
      basis: summary.briefing.basis,
      action: summary.briefing.action,
      impact: summary.briefing.impact
    }
  };
  const overdueCustomers = customers.filter((customer) => customerReminderIsOverdue(customer));
  const intentCustomers = customers.filter((customer) => customer.lifecycleStatus === "intent" && !customer.hasWonDeal);
  const wonCustomers = customers.filter((customer) => customer.hasWonDeal || customer.lifecycleStatus === "won");
  const missingFollowUpCustomers = customers.filter((customer) => !customer.lastActivityAt || !customer.nextReminder);
  const pendingTodos = todos.filter((todo) => !todo.done && !isHistoricalTodo(todo));
  const highPriorityTodos = pendingTodos.filter((todo) => todo.priority === "high");
  qsa<HTMLButtonElement>("[data-dashboard-period]").forEach((button) => {
    const active = button.dataset.dashboardPeriod === state.dashboardPeriod;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  dashboardBoardUpdatedText = fromCache ? "缓存数据 · 后台刷新中" : `${formatTime(summary.updatedAt)} 已更新`;
  renderRoleWorkbench(summary);
  renderCustomerStatusOverview(customers);
  renderTodoInsights(summary);
  renderPriorityTasks(customers, todos);
  renderRoleWorkbenchPanels(summary);
  renderTodos(todos);
  updateTodoChips(todos);
  renderDashboardDataBoard(summary.dataBoards?.[state.dashboardPeriod], summary.orderWorkflow);
}


function openWorkbenchView(view: string) {
  if(view.startsWith("data-dashboard:")){activeDashboardBoard=view.split(":")[1] as typeof activeDashboardBoard;view="data-dashboard";}
  const permission=viewPermissionRequirements[view];
  if(permission&&!hasIamCapability(permission)){toast("当前岗位未授权查看此页面","error");return;}
  if(view === "dashboard"){qs<HTMLElement>("#dashboard .todo-board")?.scrollIntoView({block:"nearest",behavior:"smooth"});return;}
  activateNavView(view);
}


function renderRoleWorkbench(summary: DashboardSummary) {
  const info=summary.workbench;if(!info)return;
  qs<HTMLElement>("#dashboard .focus-title h2")!.textContent=info.title;
  qs<HTMLElement>("#dashboard .focus-title p")!.textContent=info.description;
  for(const [id,value] of [["briefingBasis",info.basis],["briefingAction",info.action],["briefingImpact",info.impact]])qs<HTMLElement>("#"+id)!.textContent=value;
  const root=qs<HTMLElement>("#dashboard .focus-panel")!;root.dataset.workbenchProfile=info.profile;root.setAttribute("aria-label",info.label);
  qsa<HTMLElement>("#dashboard .focus-metric").forEach((cell,index)=>{
    const metric=info.metrics[index];if(!metric)return;
    cell.innerHTML=`<span>${escapeHtml(metric.label)}</span><b>${Number(metric.value||0).toLocaleString("zh-CN")} ${escapeHtml(metric.unit)}</b><small>${escapeHtml(metric.hint || "点击查看详情")}</small>`;
    cell.tabIndex=0;cell.setAttribute("role","button");cell.setAttribute("aria-label",metric.label);cell.style.cursor="pointer";
    cell.onclick=()=>openWorkbenchView(metric.view);cell.onkeydown=event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();openWorkbenchView(metric.view);}};
  });
}


function renderRoleWorkbenchPanels(summary: DashboardSummary) {
  const info=summary.workbench;if(!info)return;
  const panels=qsa<HTMLElement>("#dashboard > .dashboard-grid > .panel");
  const queuePanel=panels[0],statusPanel=panels[1];if(!queuePanel||!statusPanel)return;
  const scope=escapeHtml(summary.scopeLabels.business);
  qs<HTMLElement>("h2",queuePanel)!.innerHTML=`${escapeHtml(info.queueTitle)} <span class="scope-tag">${scope}</span>`;
  qs<HTMLElement>("h2",statusPanel)!.innerHTML=`${escapeHtml(info.distributionTitle)} <span class="scope-tag">${scope}</span>`;
  qs<HTMLButtonElement>("#batchPriorityButton")!.hidden=info.profile!=="sales";
  if(info.profile==="sales"){
    if(!state.customers.some(c=>c.ownerId===state.user?.id))qs<HTMLElement>(".task-list",queuePanel)!.innerHTML='<div class="todo-history-empty">暂无客户数据，可先新增或导入客户。</div>';
    return;
  }
  const list=qs<HTMLElement>(".task-list",queuePanel)!;
  list.innerHTML=info.queue.length?info.queue.map(row=>`<button type="button" class="workbench-queue-item" data-workbench-view="${escapeHtml(row.view)}"><span><b>${escapeHtml(row.title)}</b><small>${escapeHtml(row.subtitle)}</small></span><span>查看 →</span></button>`).join(""):'<div class="todo-history-empty">当前暂无需要处理的业务</div>';
  qsa<HTMLButtonElement>("[data-workbench-view]",list).forEach(button=>button.onclick=()=>openWorkbenchView(button.dataset.workbenchView||"dashboard"));
  const max=Math.max(1,...info.distribution.map(row=>row.count));
  qs<HTMLElement>(".bars",statusPanel)!.innerHTML=info.distribution.map(row=>`<div class="workbench-status-row"><span>${escapeHtml(row.label)}</span><div><i style="width:${row.count/max*100}%"></i></div><b>${row.count} 张</b></div>`).join("");
}


function dashboardMetricCards(host: HTMLElement | null, cards: Array<{ label: string; value: string; hint: string }>) {
  if (!host) return;
  host.innerHTML = cards.map((item) => `<div><span>${escapeHtml(item.label)}</span><b>${escapeHtml(item.value)}</b><small>${escapeHtml(item.hint)}</small></div>`).join("");
}


function dashboardQuantity(value: number, unit: string) {
  if (unit === "元") return currencyAmount(value);
  return `${Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} ${unit}`;
}


function ensureDashboardBoardView() {
  const board = qs<HTMLElement>(".dashboard-data-board");
  const mount = qs<HTMLElement>("#dataDashboardMount");
  if (board && mount && board.parentElement !== mount) mount.appendChild(board);
}


function renderDashboardDataBoard(board: DashboardSummary["dataBoards"][DashboardPeriod] | undefined, fallbackOrders: DashboardSummary["orderWorkflow"]) {
  ensureDashboardBoardView();
  const available = state.summary?.availableBoards || ["tasks","customers","orders",...(hasIamCapability("purchase.order.read") ? ["purchases"] : []),"outbound"];
  if (!available.includes(activeDashboardBoard)) activeDashboardBoard = "tasks";
  const tabs=qs<HTMLElement>(".dashboard-board-tabs");
  if(tabs)tabs.style.gridTemplateColumns=`repeat(${available.length},minmax(0,1fr))`;
  qsa<HTMLButtonElement>("[data-dashboard-board]").forEach((button) => {
    button.hidden = !available.includes(button.dataset.dashboardBoard || "");
    const active = button.dataset.dashboardBoard === activeDashboardBoard;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.onclick = () => {
      activeDashboardBoard = (button.dataset.dashboardBoard || "tasks") as typeof activeDashboardBoard;
      renderDashboardDataBoard(board, fallbackOrders);
    };
  });
  qsa<HTMLElement>("[data-dashboard-board-pane]").forEach((pane) => { pane.hidden = !available.includes(pane.dataset.dashboardBoardPane || ""); pane.classList.toggle("active", !pane.hidden && pane.dataset.dashboardBoardPane === activeDashboardBoard); });
  const range = qs<HTMLElement>("#dashboardBoardRange");
  if (range) range.textContent = board
    ? `${dashboardBoardUpdatedText} · ${board.start} 至 ${board.end} · 实时统计人员工作量与经营进度`
    : `${dashboardBoardUpdatedText} · 实时统计人员工作量与经营进度`;
  if (board) {
    dashboardBoardStartDate = board.start; dashboardBoardEndDate = board.end;
    setFieldValue("#dashboardBoardStartDate", board.start); setFieldValue("#dashboardBoardEndDate", board.end);
  }
  const taskActions = qs<HTMLElement>("#dashboardTaskManagerActions");
  if (taskActions) taskActions.hidden = !monthlySalesTargetCanManage;
  if (!board) {
    renderDashboardOrderWorkflow(fallbackOrders);
    return;
  }
  const actuals = board.taskAchievement.actuals;
  dashboardMetricCards(qs("#dashboardTaskActuals"), [
    { label: "已发布任务", value: `${actuals.salespeople} 人`, hint: board.taskAchievement.month },
    { label: "销售额目标", value: currencyAmount(actuals.targetAmount), hint: "按销售员任务汇总" },
    { label: "已完成销售额", value: currencyAmount(actuals.completedAmount), hint: "根据有效销售订单核算" },
    { label: "总体完成率", value: `${actuals.overallProgress}%`, hint: "完成额 ÷ 目标额" }
  ]);
  const companyProjected = board.taskAchievement.rows.reduce((sum, item) => sum + item.projected, 0);
  const companyRemaining = Math.max(0, actuals.targetAmount - actuals.completedAmount);
  const companyStatus = actuals.targetAmount <= 0 ? "未设置目标" : actuals.completedAmount >= actuals.targetAmount ? "已达成" : companyProjected >= actuals.targetAmount ? "预计可达成" : "存在差距";
  const companyHost = qs<HTMLElement>("#dashboardCompanyTaskSummary");
  if (companyHost) companyHost.innerHTML = `<article class="dashboard-task-card"><header><b>全公司销售任务</b><em>${companyStatus}</em></header><div class="dashboard-task-values"><div><span>销售额目标</span><b>${currencyAmount(actuals.targetAmount)}</b></div><div><span>已完成</span><b>${currencyAmount(actuals.completedAmount)}</b></div><div><span>还差</span><b>${currencyAmount(companyRemaining)}</b></div></div><div class="dashboard-task-progress"><i style="width:${Math.min(100, actuals.overallProgress)}%"></i></div><small>全公司完成率 ${actuals.overallProgress}% · 预计完成 ${currencyAmount(companyProjected)}</small></article>`;
  const taskHost = qs<HTMLElement>("#dashboardTaskRows");
  if (taskHost) taskHost.innerHTML = board.taskAchievement.rows.length ? board.taskAchievement.rows.map((item) => `<article class="dashboard-task-card"><header><b>${escapeHtml(item.label)}</b><em>${escapeHtml(item.status)}</em></header><div class="dashboard-task-values"><div><span>销售额目标</span><b>${dashboardQuantity(item.target, item.unit)}</b></div><div><span>已完成</span><b>${dashboardQuantity(item.completed, item.unit)}</b></div><div><span>还差</span><b>${dashboardQuantity(item.remaining, item.unit)}</b></div></div><div class="dashboard-task-progress"><i style="width:${Math.min(100, item.progress)}%"></i></div><small>完成率 ${item.progress}% · 预计完成 ${dashboardQuantity(item.projected, item.unit)}</small></article>`).join("") : `<div class="todo-history-empty">所选月份还没有导入销售员任务。</div>`;
  const customers = board.customers;
  const customerTasks = board.taskAchievement.customerRows || [];
  const customerTarget = customerTasks.reduce((sum,item)=>sum+item.target,0);
  const customerCompleted = customerTasks.reduce((sum,item)=>sum+item.completed,0);
  dashboardMetricCards(qs("#dashboardCustomerTaskActuals"), [
    {label:"新增客户目标合计",value:`${customerTarget} 位`,hint:"所选月份的新增客户总目标"},
    {label:"已新增客户",value:`${customerCompleted} 位`,hint:`手动 ${customerTasks.reduce((sum,item)=>sum+item.manual,0)} 位 · 导入 ${customerTasks.reduce((sum,item)=>sum+item.imported,0)} 位`},
    {label:"个人任务差额合计",value:`${customerTasks.reduce((sum,item)=>sum+item.remaining,0)} 位`,hint:"逐人计算，超额不抵扣他人任务"},
    {label:"新增数量完成率",value:customerTarget ? `${Math.round(customerCompleted/customerTarget*1000)/10}%` : "未设置",hint:`${customerTasks.length} 人 · 按月累计完成数量`}
  ]);
  const customerTaskHost = qs<HTMLElement>("#dashboardCustomerTaskRows");
  if(customerTaskHost) customerTaskHost.innerHTML=customerTasks.length ? customerTasks.map(item=>`<article class="dashboard-task-card"><header><b>${escapeHtml(item.label)} · 当月新增客户</b><em>${escapeHtml(item.status)}</em></header><div class="dashboard-task-values"><div><span>月度目标</span><b>${item.target} 位</b></div><div><span>已完成</span><b>${item.completed} 位</b></div><div><span>还差</span><b>${item.remaining} 位</b></div></div><div class="dashboard-task-progress"><i style="width:${Math.min(100,item.progress)}%"></i></div><small>手动新增 ${item.manual} 位 · 导入新客户 ${item.imported} 位 · 数量完成率 ${item.progress}%<br>平均每天 ${item.dailyAverage} 位 · 已过 ${item.elapsedDays} / ${item.plannedDays} 天<br>剩余 ${item.remainingDays} 天 · ${item.requiredDaily === null ? "已到截止日，仍有未完成任务" : `每天还需 ${item.requiredDaily} 位`}${item.canProject ? ` · 预计月底完成 ${item.projected} 位` : ""}</small></article>`).join("") : `<div class="todo-history-empty">尚未设置月度新增客户目标，请在导入任务模板中填写必填项“新增客户数”。手动新增和导入新客户均计入，旧客户更新不计数。</div>`;
  dashboardMetricCards(qs("#dashboardCustomerKpis"), [
    { label: "新增客户", value: `${customers.totals.added} 位`, hint: board.label },
    { label: "导入客户", value: `${customers.totals.imported} 位`, hint: "批量导入来源" },
    { label: "跟进记录", value: `${customers.totals.followUps} 次`, hint: "按操作人统计" },
    { label: "关联销售额", value: currencyAmount(customers.totals.salesAmount), hint: "所选周期销售订单" }
  ]);
  renderDashboardOrderWorkflow(board.orders);
  const orderRows = board.orders.rows;
  dashboardMetricCards(qs("#dashboardOrderKpis"), [
    { label: "流程订单", value: `${orderRows.length} 单`, hint: board.label },
    { label: "销售金额", value: currencyAmount(orderRows.reduce((sum, item) => sum + Number(item.amount || 0), 0)), hint: "可见销售订单合计" },
    { label: "已关联采购", value: `${orderRows.filter((item) => item.purchaseOrderNo).length} 单`, hint: "已有对应采购单" },
    { label: "已关联出库", value: `${orderRows.filter((item) => item.outboundOrderNo).length} 单`, hint: "已有对应出库单" }
  ]);
  const purchases = board.purchases;
  dashboardMetricCards(qs("#dashboardPurchaseKpis"), [
    { label: "采购订单", value: `${purchases.totals.orders} 单`, hint: board.label },
    { label: "采购件数", value: `${purchases.totals.quantity.toLocaleString()} 件`, hint: "订单件数合计" },
    { label: "采购重量", value: `${purchases.totals.weight.toLocaleString()} kg`, hint: "订单重量合计" },
    { label: "采购金额", value: currencyAmount(purchases.totals.amount), hint: "订单总金额" }
  ]);
  const outbound = board.outbound;
  dashboardMetricCards(qs("#dashboardOutboundKpis"), [
    { label: "出库订单", value: `${outbound.totals.orders} 单`, hint: board.label },
    { label: "待审批 / 审批驳回", value: `${outbound.totals.transit} 单`, hint: "已确认尾款，审批未完成" },
    { label: "已完结", value: `${outbound.totals.received} 单`, hint: "尾款确认且审批全部通过" },
    { label: "实际收款", value: currencyAmount(outbound.totals.receivedAmount), hint: "出库单实收合计" }
  ]);
  requestAnimationFrame(() => renderDashboardBoardCharts(board));
}


function renderDashboardOrderWorkflow(data?: DashboardSummary["orderWorkflow"]) {
  const counts = qs<HTMLElement>("#dashboardOrderStageCounts");
  if (!counts) return;
  counts.innerHTML = data?.counts?.length ? data.counts.map((item) => `<span>${escapeHtml(item.stage)} <b>${item.count}</b></span>`).join("") : `<span>暂无订单流程数据</span>`;
  const refresh = qs<HTMLButtonElement>("#dashboardOrderRefresh");
  if (refresh) refresh.onclick = () => void refreshDashboardOnly();
}


function renderDashboardBoardCharts(board: DashboardSummary["dataBoards"][DashboardPeriod]) {
  dashboardDataBoardCharts.forEach((chart) => chart.dispose());
  dashboardDataBoardCharts = [];
  dashboardDataBoardResizeObserver?.disconnect();
  const axisStyle = { axisLine: { lineStyle: { color: "#d8e2df" } }, axisLabel: { color: "#687873", fontSize: 10 }, splitLine: { lineStyle: { color: "#edf2f0" } } };
  const createChart = (selector: string, option: echarts.EChartsOption, hasData = true) => {
    const host = qs<HTMLElement>(selector);
    if (!host || !host.closest("[data-dashboard-board-pane].active")) return;
    const chart = echarts.init(host, undefined, { renderer: "svg" });
    chart.setOption({ ...option, ...(!hasData ? { graphic: { type: "text", left: "center", top: "middle", style: { text: "暂无数据", fill: "#82908c", fontSize: 13 } } } : {}) });
    dashboardDataBoardCharts.push(chart);
  };
  const bar = (selector: string, names: string[], values: number[], color = "#0f766e", horizontal = false) => createChart(selector, {
    color: [color], tooltip: { trigger: "axis", axisPointer: { type: "shadow" } }, grid: horizontal ? { left: 86, right: 28, top: 20, bottom: 28 } : { left: 58, right: 24, top: 20, bottom: 44 },
    xAxis: horizontal ? { type: "value", ...axisStyle } : { type: "category", data: names, axisLabel: { color: "#687873", fontSize: 10, interval: 0 }, axisLine: axisStyle.axisLine },
    yAxis: horizontal ? { type: "category", data: names, ...axisStyle } : { type: "value", ...axisStyle },
    series: [{ type: "bar", data: values.map((value) => Number(value.toFixed(2))), barMaxWidth: 34, itemStyle: { borderRadius: horizontal ? [0, 5, 5, 0] : [5, 5, 0, 0] } }]
  }, names.length > 0);
  const pie = (selector: string, rows: Array<{ name: string; value: number }>) => createChart(selector, {
    color: ["#0f766e", "#d99a2b", "#8f2644", "#5b7c99", "#82908c"], tooltip: { trigger: "item" }, legend: { bottom: 4, textStyle: { color: "#687873", fontSize: 10 } },
    series: [{ type: "pie", radius: ["44%", "69%"], center: ["50%", "44%"], label: { formatter: "{b}\n{c}", color: "#52645f", fontSize: 10 }, data: rows }]
  }, rows.some((item) => item.value > 0));

  if (activeDashboardBoard === "tasks") {
    const customerTasks = board.taskAchievement.customerRows || [];
    const customerZoom = customerTasks.length > 8 ? [{type:"inside" as const,start:0,end:800/customerTasks.length},{type:"slider" as const,height:14,bottom:3,start:0,end:800/customerTasks.length}] : [];
    createChart("#dashboardCustomerTaskSourceChart", {color:["#0f766e","#5b7c99"],tooltip:{trigger:"axis"},legend:{top:0},grid:{left:46,right:20,top:40,bottom:customerTasks.length>8?64:42},dataZoom:customerZoom,xAxis:{type:"category",data:customerTasks.map(item=>item.label),axisLabel:{interval:0,fontSize:10}},yAxis:{type:"value",minInterval:1,...axisStyle},series:[{name:"手动新增",type:"bar",stack:"新增",data:customerTasks.map(item=>item.manual),barMaxWidth:34},{name:"导入新客户",type:"bar",stack:"新增",data:customerTasks.map(item=>item.imported),barMaxWidth:34}]},customerTasks.length>0);
    createChart("#dashboardCustomerTaskProgressChart", {color:["#0f766e"],tooltip:{trigger:"axis",valueFormatter:value=>`${value}%`},grid:{left:46,right:20,top:24,bottom:customerTasks.length>8?64:42},dataZoom:customerZoom,xAxis:{type:"category",data:customerTasks.map(item=>item.label),axisLabel:{interval:0,fontSize:10}},yAxis:{type:"value",min:0,axisLabel:{formatter:"{value}%"},splitLine:axisStyle.splitLine},series:[{name:"新增数量完成率",type:"line",data:customerTasks.map(item=>item.progress),symbolSize:8,markLine:{silent:true,symbol:"none",data:[{yAxis:100}],label:{formatter:"目标 100%"}}}]},customerTasks.length>0);
    const rows = board.taskAchievement.rows;
    const zoom = rows.length > 8 ? [{ type: "inside" as const, start: 0, end: Math.max(20, 800 / rows.length) }, { type: "slider" as const, height: 14, bottom: 5, start: 0, end: Math.max(20, 800 / rows.length) }] : [];
    createChart("#dashboardTaskCompareChart", { color: ["#0f766e"], tooltip: { trigger: "axis", valueFormatter: (value) => `${value}%` }, grid: { left: 46, right: 20, top: 24, bottom: rows.length > 8 ? 58 : 42 }, dataZoom: zoom, xAxis: { type: "category", boundaryGap: false, data: rows.map((item) => item.label), axisLabel: { color: "#687873", fontSize: 10, interval: 0 }, axisLine: axisStyle.axisLine }, yAxis: { type: "value", min: 0, axisLabel: { formatter: "{value}%", color: "#687873", fontSize: 10 }, splitLine: axisStyle.splitLine }, series: [{ name: "完成率", type: "line", smooth: true, symbolSize: 8, data: rows.map((item) => item.progress), areaStyle: { opacity: .08 }, lineStyle: { width: 3 }, markLine: { silent: true, symbol: "none", lineStyle: { color: "#d99a2b", type: "dashed" }, label: { formatter: "目标 100%", color: "#9a6700", fontSize: 9 }, data: [{ yAxis: 100 }] } }] }, rows.length > 0);
    const contributionRows = rows.filter((item) => item.completed > 0).map((item) => ({ name: item.label, value: item.completed }));
    createChart("#dashboardTaskShareChart", { color: ["#0f766e", "#8f2644", "#d99a2b", "#5b7c99", "#55a58b", "#a77586", "#82908c"], tooltip: { trigger: "item", formatter: "{b}<br/>销售额：¥{c}<br/>占比：{d}%" }, legend: { type: "scroll", bottom: 2, textStyle: { color: "#687873", fontSize: 10 } }, series: [{ type: "pie", radius: ["42%", "68%"], center: ["50%", "43%"], label: { formatter: "{b}\n{d}%", color: "#52645f", fontSize: 10 }, data: contributionRows }] }, contributionRows.length > 0);
    createChart("#dashboardTaskActualChart", { color: ["#8f2644", "#0f766e"], tooltip: { trigger: "axis" }, legend: { top: 0, textStyle: { fontSize: 10 } }, grid: { left: 58, right: 20, top: 42, bottom: rows.length > 8 ? 58 : 42 }, dataZoom: zoom, xAxis: { type: "category", data: rows.map((item) => item.label), axisLabel: { color: "#687873", fontSize: 10, interval: 0 }, axisLine: axisStyle.axisLine }, yAxis: { type: "value", ...axisStyle }, series: [{ name: "销售额目标", type: "bar", data: rows.map((item) => item.target), barMaxWidth: 30 }, { name: "已完成", type: "bar", data: rows.map((item) => item.completed), barMaxWidth: 30 }] }, rows.length > 0);
  } else if (activeDashboardBoard === "customers") {
    const rows = board.customers.rows;
    createChart("#dashboardCustomerWorkChart", { color: ["#0f766e", "#5b7c99", "#d99a2b"], tooltip: { trigger: "axis" }, legend: { top: 0, textStyle: { fontSize: 10 } }, grid: { left: 45, right: 20, top: 42, bottom: 40 }, xAxis: { type: "category", data: rows.map((item) => item.owner), axisLabel: { color: "#687873", fontSize: 10 }, axisLine: axisStyle.axisLine }, yAxis: { type: "value", minInterval: 1, ...axisStyle }, series: [{ name: "导入", type: "bar", data: rows.map((item) => item.imported) }, { name: "手动新增", type: "bar", data: rows.map((item) => item.manual) }, { name: "跟进", type: "bar", data: rows.map((item) => item.followUps) }] }, rows.length > 0);
    bar("#dashboardCustomerSalesChart", rows.map((item) => item.owner), rows.map((item) => item.salesAmount), "#8f2644");
    pie("#dashboardCustomerStatusChart", [{ name: "普通客户", value: rows.reduce((sum, item) => sum + item.open, 0) }, { name: "意向客户", value: rows.reduce((sum, item) => sum + item.intent, 0) }, { name: "成交客户", value: rows.reduce((sum, item) => sum + item.won, 0) }]);
    pie("#dashboardCustomerOriginChart", [{ name: "导入", value: rows.reduce((sum, item) => sum + item.imported, 0) }, { name: "手动新增", value: rows.reduce((sum, item) => sum + item.manual, 0) }]);
  } else if (activeDashboardBoard === "orders") {
    const rows = board.orders.rows;
    const ownerAmounts = new Map<string, number>(); const stageAmounts = new Map<string, number>();
    rows.forEach((item) => { ownerAmounts.set(item.owner || "未分配", (ownerAmounts.get(item.owner || "未分配") || 0) + Number(item.amount || 0)); stageAmounts.set(item.stage || "未分类", (stageAmounts.get(item.stage || "未分类") || 0) + Number(item.amount || 0)); });
    pie("#dashboardOrderStageChart", board.orders.counts.map((item) => ({ name: item.stage, value: item.count })));
    bar("#dashboardOrderOwnerChart", [...ownerAmounts.keys()], [...ownerAmounts.values()], "#8f2644");
    bar("#dashboardOrderAmountChart", [...stageAmounts.keys()], [...stageAmounts.values()], "#0f766e");
    const full = rows.filter((item) => item.purchaseOrderNo && item.outboundOrderNo).length; const purchaseOnly = rows.filter((item) => item.purchaseOrderNo && !item.outboundOrderNo).length;
    pie("#dashboardOrderLinkChart", [{ name: "销售单", value: Math.max(0, rows.length - full - purchaseOnly) }, { name: "已关联采购", value: purchaseOnly }, { name: "采购及出库齐全", value: full }]);
  } else if (activeDashboardBoard === "purchases") {
    const rows = board.purchases.rows; const products = board.purchases.products;
    bar("#dashboardPurchaseOwnerAmountChart", rows.map((item) => item.purchaser), rows.map((item) => item.amount), "#0f766e");
    bar("#dashboardPurchaseProductAmountChart", products.map((item) => item.product), products.map((item) => item.amount), "#8f2644", true);
    bar("#dashboardPurchaseWeightChart", rows.map((item) => item.purchaser), rows.map((item) => item.weight), "#5b7c99");
    pie("#dashboardPurchaseProductShareChart", products.map((item) => ({ name: item.product, value: item.amount })));
  } else {
    const rows = board.outbound.rows;
    createChart("#dashboardOutboundProgressChart", { color: ["#d99a2b", "#5b7c99", "#0f766e"], tooltip: { trigger: "axis" }, legend: { top: 0, textStyle: { fontSize: 10 } }, grid: { left: 45, right: 20, top: 42, bottom: 40 }, xAxis: { type: "category", data: rows.map((item) => item.owner), axisLabel: { color: "#687873", fontSize: 10 }, axisLine: axisStyle.axisLine }, yAxis: { type: "value", minInterval: 1, ...axisStyle }, series: [{ name: "待财务确认", type: "bar", stack: "total", data: rows.map((item) => item.pending) }, { name: "待审批 / 审批驳回", type: "bar", stack: "total", data: rows.map((item) => item.transit) }, { name: "已完结", type: "bar", stack: "total", data: rows.map((item) => item.received) }] }, rows.length > 0);
    bar("#dashboardOutboundReceivedChart", rows.map((item) => item.owner), rows.map((item) => item.receivedAmount), "#0f766e");
    pie("#dashboardOutboundStatusChart", [{ name: "待财务确认", value: Math.max(0, board.outbound.totals.orders - board.outbound.totals.transit - board.outbound.totals.received) }, { name: "待审批 / 审批驳回", value: board.outbound.totals.transit }, { name: "已完结", value: board.outbound.totals.received }]);
    createChart("#dashboardOutboundMoneyChart", { color: ["#8f2644", "#0f766e"], tooltip: { trigger: "axis" }, legend: { top: 0, textStyle: { fontSize: 10 } }, grid: { left: 58, right: 20, top: 42, bottom: 40 }, xAxis: { type: "category", data: rows.map((item) => item.owner), axisLabel: { color: "#687873", fontSize: 10 }, axisLine: axisStyle.axisLine }, yAxis: { type: "value", ...axisStyle }, series: [{ name: "销售金额", type: "bar", data: rows.map((item) => item.salesAmount) }, { name: "实际收款", type: "bar", data: rows.map((item) => item.receivedAmount) }] }, rows.length > 0);
  }
  const dashboard = qs<HTMLElement>(".dashboard-data-board");
  if (dashboard) { dashboardDataBoardResizeObserver = new ResizeObserver(() => dashboardDataBoardCharts.forEach((chart) => chart.resize())); dashboardDataBoardResizeObserver.observe(dashboard); }
}


function dashboardMoneyText(rows: Array<{ currency: string; amount: number }>) {
  if (!rows.length) return "¥0";
  return rows.map((row) => {
    const amount = Math.abs(row.amount) >= 1000
      ? `${Number((row.amount / 1000).toFixed(row.amount % 1000 === 0 ? 0 : 1))}k`
      : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(row.amount);
    return `¥${amount}`;
  }).join(" / ");
}


function formatTodoTime(value = ""): string {
  const text = value.trim();
  if (!text) return "";
  const date = new Date(text);
  if (Number.isFinite(date.getTime())) {
    const pad = (item: number) => String(item).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  const idTime = text.match(/^t_(\d{10,}).*/);
  if (idTime) {
    const stampDate = new Date(Number(idTime[1]));
    if (Number.isFinite(stampDate.getTime())) return formatTodoTime(stampDate.toISOString());
  }
  return text;
}


function renderDashboardDense(summary: DashboardSummary) {
  const cards = qsa<HTMLElement>("#dashboard > .dense-grid .dense-card");
  const values = [
    { label: "资料待更新", value: String(summary.metrics.pendingKnowledge), note: "来自资料库" },
    { label: "产品知识考试通过率", value: `${summary.metrics.examPassRate}%`, note: "已发布考试均值" },
    { label: "未发布考试", value: String(summary.metrics.unfinishedExams), note: "待维护" },
    { label: "客户资料完整度", value: `${summary.metrics.customerCompleteness}%`, note: "按关键字段计算" }
  ];
  cards.forEach((card, index) => {
    const item = values[index];
    if (!item) return;
    card.innerHTML = `<span>${item.label}</span><b>${item.value}</b><small>${item.note}</small>`;
  });
}


function renderDashboardKnowledgePanels(assets = state.knowledgeAssets, exams = state.exams) {
  const assetBody = qs<HTMLElement>("#dashboard-knowledge-panel tbody");
  if (assetBody) {
    assetBody.innerHTML = assets.length ? assets.slice(0, 4).map((asset) => {
      const statusText = asset.status === "published" ? "已发布" : asset.status === "review" ? "待审" : "草稿";
      const tone = asset.status === "published" ? "green" : asset.status === "review" ? "amber" : "";
      return `<tr><td>${escapeHtml(asset.title)}</td><td>${escapeHtml(asset.category)}</td><td>${badge(statusText, tone)}</td><td>${escapeHtml(ownerName(asset.ownerId))}</td></tr>`;
    }).join("") : `<tr><td colspan="4">暂无资料数据</td></tr>`;
  }

  const examBody = qs<HTMLElement>("#dashboard-exam-panel tbody");
  if (examBody) {
    examBody.innerHTML = exams.length ? exams.slice(0, 4).map((exam) => `<tr><td>${escapeHtml(exam.title)}</td><td>${exam.questionCount}</td><td>${exam.passRate}%</td></tr>`).join("") : `<tr><td colspan="3">暂无考试数据</td></tr>`;
  }

  const gapBody = qs<HTMLElement>("#dashboard-gap-panel tbody");
  if (!gapBody) return;
  const grouped = exams.reduce<Record<string, { total: number; count: number }>>((acc, exam) => {
    acc[exam.category] ||= { total: 0, count: 0 };
    acc[exam.category].total += exam.passRate;
    acc[exam.category].count += 1;
    return acc;
  }, {});
  const rows = Object.entries(grouped)
    .map(([category, item]) => ({ category, passRate: Math.round(item.total / Math.max(item.count, 1)) }))
    .sort((left, right) => left.passRate - right.passRate);
  gapBody.innerHTML = rows.length ? rows.slice(0, 4).map((row) => {
    const action = row.passRate < 70 ? "补考" : row.passRate < 85 ? "复训" : "达标";
    const tone = row.passRate < 70 ? "red" : row.passRate < 85 ? "amber" : "green";
    return `<tr><td>${escapeHtml(row.category)}</td><td>${row.passRate}%</td><td>${badge(action, tone)}</td></tr>`;
  }).join("") : `<tr><td colspan="3">暂无考试类目数据</td></tr>`;
}


function renderTodoInsights(summary: DashboardSummary) {
  const scoreCards = qsa<HTMLElement>(".todo-score-card b");
  if (scoreCards[0]) scoreCards[0].textContent = String(summary.todoInsights.total);
  if (scoreCards[1]) scoreCards[1].textContent = String(summary.todoInsights.overdue);
  if (scoreCards[2]) scoreCards[2].textContent = `${summary.todoInsights.completionRate}%`;
  if (scoreCards[3]) scoreCards[3].textContent = money(summary.todoInsights.impactAmount);
  const table = qs<HTMLElement>("#dashboard .todo-insights .mini-table tbody");
  if (table) {
    table.innerHTML = summary.todoInsights.typeRows.length ? summary.todoInsights.typeRows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${row.count}</td><td>${badge(row.risk, row.risk === "高" ? "red" : row.risk === "中" ? "amber" : "")}</td></tr>`).join("") : `<tr><td>暂无待办</td><td>0</td><td>${badge("安全", "green")}</td></tr>`;
  }
  const calendar = qs<HTMLElement>("#dashboard .todo-calendar");
  if (calendar) {
    calendar.innerHTML = summary.todoInsights.weekLoad.map((item) => `<div class="todo-day ${item.count >= 4 ? "hot" : item.count <= 1 ? "ok" : ""}">${escapeHtml(item.day)}<br>${item.count}</div>`).join("");
  }
}


function renderPriorityTasks(customers: Customer[], todos: Todo[]) {
  const list = qs<HTMLElement>("#dashboard .task-list");
  if (!list) return;
  const pendingTodos = todos.filter((todo) => !todo.done && !isHistoricalTodo(todo));
  const tasks = customers.map((customer) => {
    const overdue = customerReminderIsOverdue(customer);
    const intent = customer.lifecycleStatus === "intent" && !customer.hasWonDeal;
    const noActivity = !customer.lastActivityAt;
    const hasTodo = pendingTodos.some((todo) => todo.related.includes(customer.company));
    const score = Math.min(100, (overdue ? 50 : 0) + (intent ? 25 : 0) + (noActivity ? 15 : 0) + (hasTodo ? 10 : 0));
    const action = overdue
      ? `联系逾期客户：${customer.company}`
      : intent
        ? `继续跟进意向客户：${customer.company}`
        : `完善客户跟进：${customer.company}`;
    const reason = [overdue ? "提醒已逾期" : "提醒未逾期", intent ? "已标记意向" : customerWonLabel(customer), noActivity ? "暂无跟进记录" : "已有跟进记录", hasTodo ? "已有待办" : "尚无待办"].join(" · ");
    return { id: customer.id, action, subtitle: `${customer.country || "城市待补充"} · ${customer.source || "来源待补充"} · ${customer.nextReminder || "未设置提醒"}`, score, reason, tone: overdue ? "red" : intent ? "amber" : "brand", badge: overdue ? "逾期" : intent ? "意向" : "待完善" };
  }).filter((task) => task.score > 0).sort((left, right) => right.score - left.score).slice(0, 5);
  list.innerHTML = tasks.length ? tasks.map((task) => `<article class="task" data-priority-task-id="${escapeHtml(task.id)}" style="--accent: var(--${task.tone === "red" ? "rose" : task.tone})">
    <i class="task-line"></i>
    <div><h3>${escapeHtml(task.action)}</h3><p>${escapeHtml(task.subtitle)}</p><div class="priority-task-meta"><span>${escapeHtml(task.reason)}</span></div></div>
    <div class="priority-score">${task.score}<br>分</div>
    ${badge(task.badge, task.tone === "red" ? "red" : task.tone === "amber" ? "amber" : "")}
  </article>`).join("") : `<div class="todo-history-empty">当前客户跟进安排正常</div>`;
}


async function batchProcessPriorityTasks(button?: HTMLButtonElement) {
  if (button) {
    button.disabled = true;
    button.textContent = "生成中";
  }
  try {
    const result = await api<{ created: Todo[]; processed: number; skipped: number }>("/api/dashboard/priority-tasks/batch-process", { method: "POST" });
    if (result.created.length) {
      state.todos.unshift(...result.created);
      renderTodos(state.todos);
      updateTodoChips(state.todos);
    }
    await refreshDashboardOnly();
    toast(result.created.length ? `已生成 ${result.created.length} 条跟进待办` : "推荐项已有待办，无需重复生成");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "批量生成跟进待办";
    }
  }
}


async function navigateFromTodo(todo: Todo) {
  const target = todoNavigation(todo);
  if (!target) {
    openModal("待办详情", `<h3>${escapeHtml(todo.title)}</h3><p>${escapeHtml(todo.related || "这是一条手动待办，尚未关联业务页面。")}</p><p>截止时间：${escapeHtml(formatTodoTime(todo.dueAt))}</p>`, '<button class="btn" data-modal-close>关闭</button>');
    return;
  }
  if (!canAccessWorkspaceView(target.view)) { toast("当前岗位无权访问该待办对应页面，请联系公司管理员", "error"); return; }
  try {
    if (target.kind === "approval") {
      const { tasks } = await api<{tasks:ApprovalTask[]}>("/api/v1/approval-tasks");
      const task = tasks.find(item => item.id === target.id);
      if (!task) { selectedApprovalInstanceId=""; activateNavView("approval-center"); toast("该审批已结束、已撤回或当前账号不再有处理权限，请在审批中心查看", "error"); return; }
      approvalCenterTab = task.status === "pending" ? "pending" : "completed";
      qsa<HTMLElement>("[data-approval-center-tab]").forEach(button=>button.classList.toggle("active",button.dataset.approvalCenterTab===approvalCenterTab));
      selectedApprovalInstanceId = approvalTaskInstanceId(task);
      await openOrderApprovalProgress(selectedApprovalInstanceId);
      return;
    }
    if (target.kind === "customer") {
      const result = await api<{customers:Customer[]}>("/api/customers");
      state.customers = result.customers;
      const customer = state.customers.find(item => item.id === target.id);
      if (!customer) { toast("关联客户已删除或当前账号无权查看", "error"); return; }
      activateNavView("customers"); openCustomerDetailPage(customer); return;
    }
    if (target.kind === "target") {
      activeDashboardBoard = "tasks"; state.dashboardPeriod="custom";
      dashboardBoardStartDate = `${target.id}-01`;
      const [year,month] = target.id.split("-").map(Number);
      dashboardBoardEndDate = `${target.id}-${String(new Date(year,month,0).getDate()).padStart(2,"0")}`;
      activateNavView("data-dashboard"); return;
    }
    activateNavView(target.view);
    if (target.kind === "outbound-payment") {
      await loadOutboundOrders(true);
      outboundOrderStartDate=""; outboundOrderEndDate=""; outboundOrderOwnerFilter=""; outboundOrderRecipientFilter=""; renderBusinessOrderFilterOptions(); renderOutboundOrders();
      if (hasIamCapability("shipment.payment.confirm")) openOutboundPaymentConfirmation(target.id);
      return;
    }
    if (target.kind === "meeting") {
      await loadMorningMeetings();
      if(!morningMeetings.some(item=>item.id===target.id)){toast("关联会议已删除或当前账号无权查看", "error");return;}
      openMorningMeetingReview(target.id); return;
    }
    if (target.kind === "invoice") { await loadPurchaseOrders(true); await openPurchaseInvoiceEditor(target.id); return; }
    await loadSalesOrders();
    const record = salesOrderRecords.find(item=>item.id===target.id);
    if (!record) { toast("关联订单已删除或当前账号无权查看", "error"); return; }
    salesOrderSearch=record.orderNo || record.customerName; salesOrderStartDate=""; salesOrderEndDate=""; salesOrderOwnerFilter=""; salesOrderCustomerFilterId=""; salesOrderCustomerFilterText="";
    setFieldValue("#salesOrderSearchInput",salesOrderSearch); setFieldValue("#salesOrderOwnerFilter", ""); setFieldValue("#salesOrderCustomerFilterInput", ""); applySalesOrderView("all");
    if (target.kind === "finance" && canAccessWorkspaceView("outbound-orders")) {
      await loadOutboundOrders(true);
      const outbound=outboundOrderRecords.find(item=>item.salesOrderId===target.id && !item.voidedAt);
      if (outbound && canAccessWorkspaceView("outbound-orders")) {
        activateNavView("outbound-orders");
        outboundOrderStartDate=""; outboundOrderEndDate=""; outboundOrderOwnerFilter=""; outboundOrderRecipientFilter=""; renderBusinessOrderFilterOptions(); renderOutboundOrders();
        if(hasIamCapability("shipment.payment.confirm") && !outbound.financeConfirmedAt) openOutboundPaymentConfirmation(outbound.id);
        else toast("已打开出库订单，请查看对应订单的财务收款状态");
      } else toast("该销售订单尚未出库；尾款在出库订单中由财务确认收款");
    }
  } catch(error) { toast(error instanceof Error ? error.message : "关联页面打开失败，请刷新重试", "error"); }
}


function renderTodos(todos: Todo[]) {
  const list = qs<HTMLElement>("#dashboard .todo-list");
  if (!list) return;
  renderTopbarStats();
  const currentTodos = activeTodos(todos);
  const archivedTodos = historyTodos(todos);
  const isHistoryView = state.todoFilter === "history";
  const visibleTodos = isHistoryView ? archivedTodos : filterTodos(currentTodos);
  if (!visibleTodos.length) {
    list.innerHTML = `<div class="todo-history-empty">${isHistoryView ? "暂无隔天历史待办" : "暂无当前清单待办，使用上方快速新增开始安排。"}</div>`;
  } else {
    list.innerHTML = visibleTodos.map((todo) => {
    const tone = todo.priority === "high" ? "red" : todo.priority === "medium" ? "amber" : "green";
    const optionalMeta = [formatTodoTime(todo.dueAt), todo.related].filter(Boolean).map((item) => `<span>${escapeHtml(item)}</span>`).join("");
    const isRunning = todo.status === "in_progress" && !todo.done;
    const pinBadge = todo.pinState === "top" ? badge("置顶", "aqua") : todo.pinState === "bottom" ? badge("沉底", "gray") : "";
    const statusBadge = isHistoryView
      ? todo.cancelledAt
        ? badge("已取消", "gray")
        : badge(todo.done ? "历史完成" : "历史归档", todo.done ? "green" : tone)
      : todo.done
        ? badge("已完成", "green")
        : isRunning
          ? badge("进行中", "aqua")
          : badge(todoTypeText(todo.type), tone);
    const runIcon = isRunning ? `<svg viewBox="0 0 24 24"><path d="M7 7h10v10H7z"/></svg>` : `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
    const menuOpen = state.openTodoMenuId === todo.id;
    return `<article class="todo-row ${todo.priority === "high" ? "urgent" : ""} ${isRunning ? "in-progress" : ""} ${todo.done ? "done" : ""} ${state.draggingTodoId === todo.id ? "dragging" : ""}" data-todo-id="${escapeHtml(todo.id)}">
      <i class="todo-check" title="${todo.done ? "撤回未完成" : "完成待办"}"></i>
      <div class="todo-main"><h3><button class="todo-title-link" type="button" data-todo-open>${escapeHtml(todo.title)}</button></h3><div class="todo-meta"><i class="priority-dot" style="--color:var(--${tone === "red" ? "rose" : tone})"></i><span>${escapeHtml(priorityText(todo.priority))}</span>${optionalMeta}${pinBadge}${statusBadge}</div></div>
      <div class="todo-side"><div class="todo-actions"><button class="btn" type="button" data-todo-open>${escapeHtml(todoNavigation(todo)?.label || "查看详情")}</button><div class="assignee-stack"><span class="mini-avatar">我</span></div>${isHistoryView ? todo.cancelledAt ? "" : `<button class="btn" data-todo-restore>回到今日</button>` : todo.done ? "" : `<button class="todo-run ${isRunning ? "active" : ""}" title="${isRunning ? "停止执行" : "开始执行"}" aria-label="${isRunning ? "停止执行" : "开始执行"}">${runIcon}</button>`}<button class="todo-more ${menuOpen ? "active" : ""}" title="更多操作" aria-label="更多操作"><span></span><span></span><span></span></button>${menuOpen ? `<div class="todo-menu">${isHistoryView ? "" : `<button data-todo-action="edit">编辑</button><button data-todo-action="top">置顶</button><button data-todo-action="bottom">沉底</button>`}<button class="danger" data-todo-action="delete">删除</button></div>` : ""}</div><div class="subtask-bar ${isRunning ? "running" : ""}"><i style="--p:${todo.done ? "100%" : isRunning ? "74%" : "55%"}"></i></div></div>
    </article>`;
    }).join("");
  }
  qsa<HTMLButtonElement>("[data-todo-open]",list).forEach(button=>button.onclick=event=>{
    event.stopPropagation(); const todo=todos.find(item=>item.id===button.closest<HTMLElement>("[data-todo-id]")?.dataset.todoId);
    if(todo) void navigateFromTodo(todo);
  });
  qsa<HTMLElement>(".todo-row [data-todo-restore]", list).forEach((node) => {
    node.addEventListener("click", async (event) => {
      event.stopPropagation();
      const row = node.closest<HTMLElement>(".todo-row");
      if (row?.dataset.todoId) await restoreTodoFromHistory(row.dataset.todoId);
    });
  });
  qsa<HTMLElement>(".todo-row .todo-run", list).forEach((node) => {
    node.addEventListener("click", async (event) => {
      event.stopPropagation();
      const row = node.closest<HTMLElement>(".todo-row");
      if (row?.dataset.todoId) await toggleTodoExecution(row.dataset.todoId);
    });
  });
  qsa<HTMLElement>(".todo-row .todo-more", list).forEach((node) => {
    node.addEventListener("click", async (event) => {
      event.stopPropagation();
      const row = node.closest<HTMLElement>(".todo-row");
      state.openTodoMenuId = state.openTodoMenuId === row?.dataset.todoId ? null : row?.dataset.todoId || null;
      renderTodos(state.todos);
    });
  });
  qsa<HTMLElement>(".todo-row .todo-menu button", list).forEach((node) => {
    node.addEventListener("click", async (event) => {
      event.stopPropagation();
      const row = node.closest<HTMLElement>(".todo-row");
      const action = node.dataset.todoAction;
      if (!row?.dataset.todoId || !action) return;
      state.openTodoMenuId = null;
      if (action === "edit") {
        const todo = state.todos.find((item) => item.id === row.dataset.todoId);
        if (todo) openTodoModal("", todo);
        return;
      }
      if (action === "delete") {
        await deleteTodo(row.dataset.todoId, node as HTMLButtonElement);
        return;
      }
      if (isHistoryView) return;
      await pinTodo(row.dataset.todoId, action as "top" | "bottom");
    });
  });
  qsa<HTMLElement>(".todo-row .todo-check", list).forEach((node) => {
    node.addEventListener("click", async (event) => {
      event.stopPropagation();
      const row = node.closest<HTMLElement>(".todo-row");
      if (!row?.dataset.todoId) return;
      const todo = state.todos.find((item) => item.id === row.dataset.todoId);
      if (!todo) return;
      const nextDone = !todo.done;
      const result = await api<{ todo: Todo }>(`/api/todos/${todo.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: nextDone })
      });
      Object.assign(todo, result.todo);
      renderTodos(state.todos);
      updateTodoChips(state.todos);
      void refreshDashboardOnly();
      toast(todo.done ? "待办已完成" : "已撤回未完成");
    });
  });
  bindTodoDrag(list, visibleTodos, isHistoryView);
  const total = visibleTodos.length;
  const overdue = visibleTodos.filter((todo) => todo.priority === "high" && !todo.done).length;
  const done = visibleTodos.filter((todo) => todo.done).length;
  const scoreCards = qsa<HTMLElement>(".todo-score-card b");
  if (scoreCards[0]) scoreCards[0].textContent = String(total);
  if (scoreCards[1]) scoreCards[1].textContent = String(overdue);
  if (scoreCards[2]) scoreCards[2].textContent = `${Math.round((done / Math.max(total, 1)) * 100)}%`;
  if (scoreCards[3]) scoreCards[3].textContent = money(visibleTodos.reduce((sum, todo) => sum + (todo.impactAmount || 0), 0));
  renderTodoHistory(archivedTodos);
}


function visibleTodoIds(todos: Todo[]) {
  return todos.map((todo) => todo.id);
}


async function persistTodoOrder(ids: string[], mode: "manual" | "top" | "bottom", targetId?: string) {
  const result = await api<{ todos: Todo[] }>("/api/todos/reorder", {
    method: "POST",
    body: JSON.stringify({ ids, mode, targetId })
  });
  result.todos.forEach((updated) => {
    const todo = state.todos.find((item) => item.id === updated.id);
    if (todo) Object.assign(todo, updated);
  });
  renderTodos(state.todos);
  updateTodoChips(state.todos);
}


async function pinTodo(id: string, mode: "top" | "bottom") {
  const current = filterTodos(activeTodos(state.todos));
  const sameGroup = current.filter((todo) => todo.done === state.todos.find((item) => item.id === id)?.done);
  const rest = sameGroup.filter((todo) => todo.id !== id).map((todo) => todo.id);
  const ids = mode === "top" ? [id, ...rest] : [...rest, id];
  await persistTodoOrder(ids, mode, id);
  toast(mode === "top" ? "已置顶" : "已沉底");
}


function bindTodoDrag(list: HTMLElement, visibleTodos: Todo[], isHistoryView: boolean) {
  if (isHistoryView) return;
  let holdTimer = 0;
  let dragId = "";
  let pointerId = 0;
  let lastDropId = "";
  const clearHold = () => {
    if (holdTimer) window.clearTimeout(holdTimer);
    holdTimer = 0;
  };
  const markDropTarget = (clientX: number, clientY: number) => {
    const targetRow = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(".todo-row");
    if (!targetRow || targetRow.dataset.todoId === dragId || targetRow.closest("#dashboard .todo-list") !== list) return;
    lastDropId = targetRow.dataset.todoId || "";
    qsa<HTMLElement>(".todo-row.drop-target", list).forEach((item) => item.classList.remove("drop-target"));
    targetRow.classList.add("drop-target");
  };
  const documentMove = (event: PointerEvent) => {
    if (!dragId) return;
    markDropTarget(event.clientX, event.clientY);
  };
  const documentUp = (event: PointerEvent) => {
    void finishDrag(event.clientX, event.clientY);
  };
  const removeDocumentDragEvents = () => {
    document.removeEventListener("pointermove", documentMove);
    document.removeEventListener("pointerup", documentUp);
    document.removeEventListener("pointercancel", cancelDrag);
  };
  const finishDrag = async (clientX: number, clientY: number) => {
    clearHold();
    if (!dragId) return;
    removeDocumentDragEvents();
    const dropRow = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(".todo-row");
    const dragged = visibleTodos.find((todo) => todo.id === dragId);
    const targetId = dropRow?.dataset.todoId && dropRow.closest("#dashboard .todo-list") === list ? dropRow.dataset.todoId : lastDropId;
    const target = visibleTodos.find((todo) => todo.id === targetId);
    const draggedId = dragId;
    dragId = "";
    lastDropId = "";
    state.draggingTodoId = null;
    qsa<HTMLElement>(".todo-row.dragging, .todo-row.drop-target", list).forEach((item) => item.classList.remove("dragging", "drop-target"));
    if (!dragged || !target || dragged.id === target.id || dragged.done !== target.done) {
      renderTodos(state.todos);
      return;
    }
    const group = visibleTodos.filter((todo) => todo.done === dragged.done);
    const ids = visibleTodoIds(group).filter((id) => id !== draggedId);
    ids.splice(ids.indexOf(target.id), 0, draggedId);
    await persistTodoOrder(ids, "manual", draggedId);
    toast("已按拖拽顺序保存");
  };
  const cancelDrag = () => {
    clearHold();
    removeDocumentDragEvents();
    dragId = "";
    lastDropId = "";
    state.draggingTodoId = null;
    renderTodos(state.todos);
  };
  qsa<HTMLElement>(".todo-row", list).forEach((row) => {
    row.addEventListener("pointerdown", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("button") || target.closest(".todo-check") || target.closest(".todo-menu")) return;
      const id = row.dataset.todoId;
      if (!id) return;
      pointerId = event.pointerId;
      holdTimer = window.setTimeout(() => {
        dragId = id;
        state.draggingTodoId = id;
        state.openTodoMenuId = null;
        row.classList.add("dragging");
        row.setPointerCapture(pointerId);
        document.addEventListener("pointermove", documentMove);
        document.addEventListener("pointerup", documentUp);
        document.addEventListener("pointercancel", cancelDrag);
        toast("拖动到目标位置后松手排序");
      }, 280);
    });
    row.addEventListener("pointermove", (event) => {
      if (!dragId || state.draggingTodoId !== dragId) return;
      markDropTarget(event.clientX, event.clientY);
    });
    row.addEventListener("pointerup", (event) => void finishDrag(event.clientX, event.clientY));
    row.addEventListener("pointercancel", cancelDrag);
    row.addEventListener("pointerleave", clearHold);
  });
  list.addEventListener("pointermove", (event) => {
    if (!dragId) return;
    markDropTarget(event.clientX, event.clientY);
  });
  list.addEventListener("pointerup", (event) => void finishDrag(event.clientX, event.clientY));
  list.addEventListener("pointercancel", cancelDrag);
}


async function toggleTodoExecution(id: string) {
  const todo = state.todos.find((item) => item.id === id);
  if (!todo || todo.done) return;
  const nextStatus = todo.status === "in_progress" ? "pending" : "in_progress";
  const result = await api<{ todo: Todo }>(`/api/todos/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: nextStatus })
  });
  Object.assign(todo, result.todo);
  renderTodos(state.todos);
  updateTodoChips(state.todos);
  void refreshDashboardOnly();
  toast(nextStatus === "in_progress" ? "已开始执行" : "已停止执行");
}


function renderTodoHistory(todos: Todo[]) {
  const list = qs<HTMLElement>("#dashboard .todo-history-list");
  const count = qs<HTMLElement>("#dashboard #todo-history-count");
  const amountNode = qs<HTMLElement>("#dashboard #todo-history-amount");
  if (count) count.textContent = `${todos.length} 条`;
  if (amountNode) amountNode.textContent = money(todos.reduce((sum, todo) => sum + (todo.impactAmount || 0), 0));
  if (!list) return;
  const recent = todos.slice(0, 5);
  list.innerHTML = recent.length ? recent.map((todo) => {
    const tone = todo.priority === "high" ? "red" : todo.priority === "medium" ? "amber" : "green";
    const meta = [formatTodoTime(todo.dueAt), todo.related, todo.historyAt ? `归档 ${formatTodoTime(todo.historyAt)}` : ""].filter(Boolean).join(" · ") || "未设置上下文";
    const menuOpen = state.openTodoMenuId === todo.id;
    return `<article class="todo-history-row ${todo.done ? "done" : ""}" data-todo-id="${escapeHtml(todo.id)}">
      <span class="history-dot ${tone}"></span>
      <div><b>${escapeHtml(todo.title)}</b><span>${escapeHtml(meta)}</span></div>
      <div class="todo-actions">${todo.cancelledAt ? badge("已取消", "gray") : badge(todo.done ? "历史完成" : "历史归档", todo.done ? "green" : tone)}${todo.cancelledAt ? "" : `<button class="btn" data-todo-restore>回到今日</button>`}<button class="todo-more ${menuOpen ? "active" : ""}" title="更多操作" aria-label="更多操作"><span></span><span></span><span></span></button>${menuOpen ? `<div class="todo-menu"><button class="danger" data-todo-action="delete">删除</button></div>` : ""}</div>
    </article>`;
  }).join("") : `<div class="todo-history-empty">暂无隔天历史待办</div>`;
  qsa<HTMLElement>(".todo-history-row [data-todo-restore]", list).forEach((node) => {
    node.addEventListener("click", async (event) => {
      event.stopPropagation();
      const row = node.closest<HTMLElement>(".todo-history-row");
      if (row?.dataset.todoId) await restoreTodoFromHistory(row.dataset.todoId);
    });
  });
  qsa<HTMLElement>(".todo-history-row .todo-more", list).forEach((node) => {
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      const row = node.closest<HTMLElement>(".todo-history-row");
      state.openTodoMenuId = state.openTodoMenuId === row?.dataset.todoId ? null : row?.dataset.todoId || null;
      renderTodoHistory(todos);
    });
  });
  qsa<HTMLElement>(".todo-history-row .todo-menu button", list).forEach((node) => {
    node.addEventListener("click", async (event) => {
      event.stopPropagation();
      const row = node.closest<HTMLElement>(".todo-history-row");
      state.openTodoMenuId = null;
      if (row?.dataset.todoId) await deleteTodo(row.dataset.todoId, node as HTMLButtonElement);
    });
  });
  qsa<HTMLElement>(".todo-history-row", list).forEach((row) => {
    row.addEventListener("click", () => {
      const todo = state.todos.find((item) => item.id === row.dataset.todoId);
      if (todo) toast(["历史清单", todo.related, todo.dueAt].filter(Boolean).join(" · "));
    });
  });
}


async function deleteTodo(id: string, button?: HTMLButtonElement) {
  const todo = state.todos.find((item) => item.id === id);
  if (!todo) {
    toast("待办不存在", "error");
    return;
  }
  const confirmed = await confirmAction({
    title: "永久删除待办",
    message: "这条待办会从当前清单和历史记录中永久移除。",
    detail: todo.title,
    detailLabel: "待删除待办",
    consequences: ["相关客户或商机不会被删除", "待办内容与执行记录无法恢复"],
    confirmLabel: "永久删除",
    tone: "danger"
  });
  if (!confirmed) {
    renderTodos(state.todos);
    window.setTimeout(() => {
      const row = qsa<HTMLElement>(".todo-row, .todo-history-row").find((item) => item.dataset.todoId === id);
      row?.querySelector<HTMLButtonElement>(".todo-more")?.focus();
    }, 0);
    return;
  }
  setButtonPending(button || null, true, "删除", "删除中");
  try {
    await api<{ ok: boolean; id: string }>(`/api/todos/${id}`, { method: "DELETE" });
    state.todos = state.todos.filter((item) => item.id !== id);
    renderTodos(state.todos);
    updateTodoChips(state.todos);
    void refreshDashboardOnly();
    toast("待办已永久删除");
  } catch (error) {
    setButtonPending(button || null, false, "删除", "删除中");
    toast(error instanceof Error ? error.message : "删除待办失败", "error");
  }
}


async function restoreTodoFromHistory(id: string) {
  const todo = state.todos.find((item) => item.id === id);
  if (!todo) {
    toast("待办不存在", "error");
    return;
  }
  const result = await api<{ todo: Todo }>(`/api/todos/${id}/restore`, { method: "POST" });
  Object.assign(todo, result.todo);
  renderTodos(state.todos);
  updateTodoChips(state.todos);
  void refreshDashboardOnly();
  toast("已恢复到今日清单");
}


function filterTodos(todos: Todo[]) {
  if (state.todoFilter === "overdue") return todos.filter((todo) => todo.priority === "high" && !todo.done);
  if (state.todoFilter === "customer") return todos.filter((todo) => todo.type === "customer");
  return todos;
}


function updateTodoChips(todos: Todo[]) {
  const chips = qsa<HTMLElement>("#dashboard .todo-chip");
  const currentTodos = activeTodos(todos);
  const values = [
    `今天 ${currentTodos.filter((todo) => !todo.done).length}`,
    `逾期 ${currentTodos.filter((todo) => todo.priority === "high" && !todo.done).length}`,
    `我负责 ${currentTodos.length}`,
    "客户跟进",
    `历史清单 ${historyTodos(todos).length}`
  ];
  chips.forEach((chip, index) => {
    chip.textContent = values[index] || chip.textContent || "";
    const filters: AppState["todoFilter"][] = ["today", "overdue", "mine", "customer", "history"];
    chip.dataset.todoFilter = filters[index] || "all";
    chip.classList.toggle("active", state.todoFilter === chip.dataset.todoFilter || (state.todoFilter === "all" && index === 0));
  });
}


function communicationTodoTriggerKey(customerId: string, followupId: string) {
  return `whatsapp-insight:${customerId}:${followupId}`;
}


function todoMatchesCommunicationFollowup(todo: Todo, customer: Customer, followup: WhatsAppConversationInsight["followups"][number]) {
  const triggerKey = communicationTodoTriggerKey(customer.id, followup.id);
  if (todo.triggerKey === triggerKey) return true;
  const belongsToCustomer = todo.customerId === customer.id || (!todo.customerId && (todo.related || "").includes(customer.company));
  return belongsToCustomer && todo.title.trim() === followup.title.trim() && (todo.related || "").includes("WhatsApp");
}


async function createCustomerCommunicationTodo(customer: Customer, followup: WhatsAppConversationInsight["followups"][number], button: HTMLButtonElement) {
  try {
    button.disabled = true;
    button.textContent = "创建中";
    const result = await api<{ todo: Todo }>("/api/todos", {
      method: "POST",
      body: JSON.stringify({
        title: followup.title,
        type: "customer",
        priority: followup.priority,
        dueAt: followup.dueAt,
        related: `WhatsApp · ${customer.company} · ${followup.reason}`,
        customerId: customer.id,
        triggerKey: communicationTodoTriggerKey(customer.id, followup.id)
      })
    });
    if (!state.todos.some((todo) => todo.id === result.todo.id)) state.todos.unshift(result.todo);
    button.textContent = "已加入待办";
    toast("已加入华源CRM待办");
  } catch (error) {
    button.disabled = false;
    button.textContent = "转为待办";
    toast(error instanceof Error ? error.message : "待办创建失败", "error");
  }
}


async function createCustomerMeetingTodo(customer: Customer, activityId: string, button: HTMLButtonElement) {
  const meeting = customerUpcomingMeeting(customer);
  if (!meeting || meeting.activity.id !== activityId) {
    toast("会议安排已更新，请重新打开客户详情", "error");
    return;
  }
  setButtonPending(button, true, "生成会前待办", "创建中");
  try {
    const result = await api<{ todo: Todo }>("/api/todos", {
      method: "POST",
      body: JSON.stringify({
        title: `准备客户会议：${customer.company}`,
        type: "customer",
        priority: "high",
        dueAt: meeting.activity.nextReminder || customer.nextReminder || currentDateTimeText(),
        related: `会议准备：${customer.company}；${meeting.preparation}`,
        customerId: customer.id,
        triggerKey: customerMeetingTriggerKey(customer.id, meeting.activity.id)
      })
    });
    if (!state.todos.some((todo) => todo.id === result.todo.id)) state.todos.unshift(result.todo);
    button.textContent = "已加入待办";
    button.disabled = true;
    const status = button.closest<HTMLElement>(".customer-meeting-brief")?.querySelector<HTMLElement>(".badge");
    if (status) {
      status.className = "badge green";
      status.textContent = "待办已创建";
    }
    updateTodoChips(state.todos);
    renderTopbarStats();
    toast("会前准备已加入华源CRM待办");
  } catch (error) {
    setButtonPending(button, false, "生成会前待办", "创建中");
    toast(error instanceof Error ? error.message : "会前待办创建失败", "error");
  }
}


async function createSelectedProspectTodo(button?: HTMLButtonElement) {
  const item = selectedProspect();
  if (!item) {
    toast("请先选择一条搜客线索", "error");
    return;
  }
  if (item.ownerId !== state.user?.id) {
    toast("只有归属业务员可以生成跟进待办", "error");
    return;
  }
  if (button) {
    button.disabled = true;
    button.textContent = "生成中";
  }
  try {
    const result = await api<{ todo: Todo; opportunity: WebsiteOpportunity }>(`/api/prospect-list/${encodeURIComponent(item.id)}/follow-up`, {
      method: "POST",
      body: JSON.stringify({
        channel: item.lastTouchpointChannel || "email",
        priority: leadFinderScore(item) >= 76 ? "high" : "medium"
      })
    });
    syncProspectTodo(result.todo);
    Object.assign(item, result.opportunity);
    renderTodos(state.todos);
    updateTodoChips(state.todos);
    renderTopbarStats();
    renderProspectList();
    toast("已生成搜客跟进待办");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "生成待办";
    }
  }
}


function syncProspectTodo(todo?: Todo) {
  if (!todo) return;
  const existing = state.todos.find((item) => item.id === todo.id);
  if (existing) Object.assign(existing, todo);
  else state.todos.unshift(todo);
}


async function createLeadFinderTodos(button?: HTMLButtonElement) {
  const opportunities = collectLeadFinderRows();
  if (!opportunities.length) {
    toast("请先勾选需要跟进的候选客户", "error");
    return;
  }
  const unsynced = opportunities.filter((item) => state.websiteOpportunities.find((row) => row.id === item.id)?.status !== "synced");
  if (unsynced.length) {
    toast("请先确认并加入线索，再创建首个正式待办", "error");
    return;
  }
  if (button) {
    button.disabled = true;
    button.textContent = "生成中";
  }
  try {
    const created: Todo[] = [];
    for (const item of opportunities) {
      const synced = state.websiteOpportunities.find((row) => row.id === item.id);
      const result = await api<{ todo: Todo }>("/api/todos", {
        method: "POST",
        body: JSON.stringify({
          title: `首次跟进线索：${item.company}`,
          type: "customer",
          priority: "medium",
          dueAt: currentDateTimeText(),
          related: `${synced?.leadId || item.id} · ${item.company}`
        })
      });
      created.push(result.todo);
    }
    state.todos.unshift(...created);
    renderTodos(state.todos);
    updateTodoChips(state.todos);
    renderTopbarStats();
    toast(`已生成 ${created.length} 条首个跟进待办`);
  } catch (error) {
    toast(`生成待办失败：${error instanceof Error ? error.message : "请检查网络后重试"}`, "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "生成待办";
    }
  }
}


function openTodoModal(prefill = "", editing?: Todo) {
  const titleValue = editing?.title || prefill;
  openModal(editing ? "编辑待办" : "新增待办", `
    <div class="form-grid">
      <div class="form-field full"><label>待办内容</label><input id="todoTitleInput" value="${escapeHtml(titleValue)}" placeholder="例如：明天 10 点跟进重点客户报价"></div>
      <div class="form-field"><label>类型</label><select id="todoTypeInput"><option value="other">其它</option><option value="customer">客户跟进</option><option value="knowledge">资料维护</option><option value="exam">在线考试</option><option value="ocr">资料识别</option></select></div>
      <div class="form-field"><label>优先级</label><select id="todoPriorityInput"><option value="normal">普通</option><option value="medium">中优先级</option><option value="high">高优先级</option></select></div>
      <div class="form-field"><label>目标完成时间</label><input id="todoDueInput" value="${escapeHtml(editing?.dueAt || "")}" placeholder="例如：2026-06-27 18:00"></div>
      <div class="form-field"><label>关联对象</label><input id="todoRelatedInput" value="${escapeHtml(editing?.related || "")}" placeholder="可选：客户、销售订单、资料或考试名称"></div>
    </div>
  `, `<button class="btn" data-modal-close>取消</button><button class="btn primary" id="saveTodoButton">${editing ? "保存修改" : "保存待办"}</button>`);
  qs<HTMLSelectElement>("#todoTypeInput")!.value = editing?.type || "other";
  qs<HTMLSelectElement>("#todoPriorityInput")!.value = editing?.priority || "normal";
  qsa("[data-modal-close]").forEach((node) => node.addEventListener("click", closeModal));
  qs("#saveTodoButton")?.addEventListener("click", () => void saveTodo(editing?.id));
  qsa<HTMLInputElement | HTMLSelectElement>("#todoTitleInput, #todoTypeInput, #todoPriorityInput, #todoDueInput, #todoRelatedInput").forEach((node) => {
    node.addEventListener("keydown", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key !== "Enter" || keyboardEvent.isComposing) return;
      event.preventDefault();
      void saveTodo(editing?.id);
    });
  });
  qs<HTMLInputElement>("#todoTitleInput")?.focus();
}


async function saveTodo(id?: string) {
  const title = qs<HTMLInputElement>("#todoTitleInput")?.value.trim() || "";
  if (!title) {
    toast("请填写待办内容", "error");
    return;
  }
  const payload = {
    title,
    type: qs<HTMLSelectElement>("#todoTypeInput")?.value || "other",
    priority: qs<HTMLSelectElement>("#todoPriorityInput")?.value || "normal",
    dueAt: qs<HTMLInputElement>("#todoDueInput")?.value.trim() || "",
    related: qs<HTMLInputElement>("#todoRelatedInput")?.value.trim() || ""
  };
  const result = await api<{ todo: Todo }>(id ? `/api/todos/${id}` : "/api/todos", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(payload)
  });
  if (id) {
    const todo = state.todos.find((item) => item.id === id);
    if (todo) Object.assign(todo, result.todo);
  } else {
    state.todos.unshift(result.todo);
  }
  renderTodos(state.todos);
  updateTodoChips(state.todos);
  void refreshDashboardOnly();
  closeModal();
  toast(id ? "待办已更新" : "待办已新增");
}


async function createQuickTodo(title: string) {
  const trimmed = title.trim();
  if (!trimmed) return;
  const result = await api<{ todo: Todo }>("/api/todos", {
    method: "POST",
    body: JSON.stringify({
      title: trimmed,
      type: "other",
      priority: "normal",
      dueAt: "",
      related: ""
    })
  });
  state.todos.unshift(result.todo);
  renderTodos(state.todos);
  updateTodoChips(state.todos);
  void refreshDashboardOnly();
  toast("待办已新增");
}


async function pushPlanTasksToTodos(ids: string[], button?: HTMLButtonElement) {
  const tasks = ids.map((id) => state.planTasks.find((task) => task.id === id)).filter(Boolean) as PlanTask[];
  const pending = tasks.filter((task) => task.status === "planned" || task.status === "active");
  if (!pending.length) {
    toast("请选择未完成的计划任务", "error");
    return;
  }
  const existingTitles = new Set(state.todos.filter((todo) => !todo.done).map((todo) => todo.title));
  const missing = pending.filter((task) => !existingTitles.has(task.title));
  if (!missing.length) {
    toast("所选计划任务已在待办中");
    return;
  }
  if (button) button.disabled = true;
  try {
    const created: Todo[] = [];
    for (const task of missing) {
      const result = await api<{ todo: Todo }>("/api/todos", {
        method: "POST",
        body: JSON.stringify({
          title: task.title,
          type: "other",
          priority: task.priority,
          dueAt: task.dueAt,
          related: planTaskRelationLabel(task) === "未关联业务" ? `计划任务 / ${task.phase}` : planTaskRelationLabel(task)
        })
      });
      created.push(result.todo);
    }
    state.todos.unshift(...created);
    renderTodos(state.todos);
    updateTodoChips(state.todos);
    void refreshDashboardOnly();
    toast(`已推送 ${created.length} 条计划任务到待办`);
  } finally {
    if (button) button.disabled = false;
  }
}


function renderTopbarStats() {
  const todoCount = activeTodos(state.todos).filter((todo) => !todo.done).length;
  const todoNode = qs<HTMLElement>("#topTodoCount");
  if (todoNode) todoNode.textContent = String(todoCount);
}