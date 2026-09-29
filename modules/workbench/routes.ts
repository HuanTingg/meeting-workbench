

app.get("/api/todos", requireAuth, asyncRoute(async (req, res) => {
  const store = getStore();
  const financeChanged = await repairSalesFinanceTodos(store, req.user!.teamId);
  const outboundChanged = await repairOutboundPaymentTodos(store, req.user!.teamId);
  const archived = archiveExpiredTodos(store.todos, new Date());
  const customerTasksChanged = syncMonthlyCustomerTargetTodos(store.monthlySalesTargets,store.customers,store.todos);
  if (archived.length || customerTasksChanged || financeChanged || outboundChanged) await store.persist();
  const { todos } = store;
  const scoped = todos.filter((todo) => canSeePersonalData(req.user!, todo.ownerId));
  res.json({ todos: scoped });
}));


app.post("/api/todos", requireAuth, asyncRoute(async (req, res) => {
  const schema = z.object({
    title: z.string().min(1),
    type: z.enum(["customer", "knowledge", "exam", "ocr", "other"]).default("other"),
    priority: z.enum(["high", "medium", "normal"]).default("normal"),
    dueAt: z.string().default(""),
    related: z.string().default(""),
    customerId: z.string().optional(),
    leadId: z.string().optional(),
    triggerKey: z.string().min(1).max(256).optional()
  });
  const body = schema.parse(req.body);
  const store = getStore();
  if (body.triggerKey) {
    const existing = store.todos.find((item) => item.ownerId === req.user!.id && item.triggerKey === body.triggerKey);
    if (existing) {
      res.json({ todo: existing, deduplicated: true });
      return;
    }
  }
  const todo = {
    id: `t_${Date.now()}`,
    ownerId: req.user!.id,
    teamId: req.user!.teamId,
    done: false,
    status: "pending" as const,
    pinState: "" as const,
    sortOrder: nextTodoSortOrder(store.todos, req.user!.id),
    createdAt: new Date().toISOString(),
    historyAt: "",
    ...body
  };
  if (shouldArchiveTodo(todo)) {
    todo.historyAt = new Date().toISOString();
    todo.status = "pending" as const;
  }
  store.todos.unshift(todo);
  await store.persist();
  res.json({ todo });
}));


app.post("/api/todos/:id/complete", requireAuth, asyncRoute(async (req, res) => {
  const schema = z.object({ completionResult: z.string().trim().max(255).optional() });
  const body = schema.parse(req.body || {});
  const store = getStore();
  const todo = store.todos.find((item) => item.id === req.params.id);
  if (!todo || !canSeePersonalData(req.user!, todo.ownerId)) {
    res.status(404).json({ message: "待办不存在" });
    return;
  }
  if(pendingPurchaseInvoiceTodo(todo,store.purchaseOrders)){res.status(409).json({message:"该采购单尚未补齐开票日期和发票，请在采购订单中补充；待办会自动完成，不能手动删除或归档"});return;}
  if(pendingOutboundPaymentTodo(todo,store.outboundOrders)){res.status(409).json({message:"请在出库订单中由财务确认尾款，不能直接删除、归档或完成此待办"});return;}
  if(pendingSalesInvoiceTodo(todo,store.monthlySalesRecords)){res.status(409).json({message:"该销售单尚未登记开票，请在销售订单中更新开票状态；不能直接删除或归档开票待办"});return;}
  if (todo.reminderRuleId && !body.completionResult) {
    res.status(400).json({ message: "请填写本次跟进处理结果" });
    return;
  }
  todo.done = true;
  todo.status = "pending";
  todo.completedAt = new Date().toISOString();
  todo.completedBy = req.user!.id;
  todo.completionResult = body.completionResult || todo.completionResult;
  await store.persist();
  await synchronizeWhatsAppFollowup(todo, req.user!, "completed");
  res.json({ todo });
}));


app.post("/api/todos/archive-due", requireAuth, asyncRoute(async (req, res) => {
  const store = getStore();
  const scoped = store.todos.filter((todo) => canSeePersonalData(req.user!, todo.ownerId));
  const archived = archiveExpiredTodos(scoped, new Date());
  if (archived.length) await store.persist();
  res.json({ archived });
}));


app.post("/api/todos/:id/restore", requireAuth, asyncRoute(async (req, res) => {
  const store = getStore();
  const todo = store.todos.find((item) => item.id === req.params.id);
  if (!todo || !canSeePersonalData(req.user!, todo.ownerId)) {
    res.status(404).json({ message: "待办不存在" });
    return;
  }
  if (todo.cancelledAt) {
    res.status(409).json({
      message: todo.cancellationReason
        ? `该待办已取消：${todo.cancellationReason}`
        : "该待办已取消，不能恢复"
    });
    return;
  }
  todo.historyAt = "";
  todo.dueAt = currentMinuteText();
  todo.sortOrder = nextTodoSortOrder(store.todos, todo.ownerId);
  todo.pinState = "";
  if (todo.status === "in_progress" && todo.done) todo.status = "pending";
  await store.persist();
  await synchronizeWhatsAppFollowup(todo, req.user!, "pending");
  res.json({ todo });
}));


app.patch("/api/todos/:id", requireAuth, asyncRoute(async (req, res) => {
  const schema = z.object({
    title: z.string().min(1).optional(),
    type: z.enum(["customer", "knowledge", "exam", "ocr", "other"]).optional(),
    priority: z.enum(["high", "medium", "normal"]).optional(),
    dueAt: z.string().optional(),
    related: z.string().optional(),
    done: z.boolean().optional(),
    status: z.enum(["pending", "in_progress"]).optional(),
    pinState: z.enum(["top", "bottom", ""]).optional(),
    sortOrder: z.number().optional(),
    historyAt: z.string().optional()
    ,
    snoozeReason: z.string().trim().max(255).optional(),
    completionResult: z.string().trim().max(255).optional()
  });
  const body = schema.parse(req.body);
  const store = getStore();
  const todo = store.todos.find((item) => item.id === req.params.id);
  if (!todo || !canSeePersonalData(req.user!, todo.ownerId)) {
    res.status(404).json({ message: "待办不存在" });
    return;
  }
  if(pendingPurchaseInvoiceTodo(todo,store.purchaseOrders)){res.status(409).json({message:"该采购单尚未补齐开票日期和发票，请在采购订单中补充；待办会自动完成，不能手动删除或归档"});return;}
  if(pendingOutboundPaymentTodo(todo,store.outboundOrders)){res.status(409).json({message:"请在出库订单中由财务确认尾款，不能直接删除、归档或完成此待办"});return;}
  if(pendingSalesInvoiceTodo(todo,store.monthlySalesRecords)){res.status(409).json({message:"该销售单尚未登记开票，请在销售订单中更新开票状态；不能直接删除或归档开票待办"});return;}
  if (todo.cancelledAt
    && (body.done === false || body.historyAt === "")) {
    res.status(409).json({
      message: todo.cancellationReason
        ? `该待办已取消：${todo.cancellationReason}`
        : "该待办已取消，不能重新启用"
    });
    return;
  }
  if (typeof body.done === "boolean") {
    if (body.done && todo.reminderRuleId && !body.completionResult) {
      res.status(400).json({ message: "请填写本次跟进处理结果" });
      return;
    }
    todo.done = body.done;
    if (body.done) {
      todo.status = "pending";
      todo.completedAt = new Date().toISOString();
      todo.completedBy = req.user!.id;
      todo.completionResult = body.completionResult || "";
    } else {
      todo.completedAt = "";
      todo.completedBy = "";
      todo.completionResult = "";
    }
  }
  if (body.status) {
    todo.status = todo.done ? "pending" : body.status;
  }
  if (body.title) todo.title = body.title;
  if (body.type) todo.type = body.type;
  if (body.priority) todo.priority = body.priority;
  if (body.dueAt !== undefined) {
    if (todo.reminderRuleId && body.dueAt !== todo.dueAt) {
      if (!body.snoozeReason) {
        res.status(400).json({ message: "延期提醒请填写原因" });
        return;
      }
      todo.snoozedFrom = todo.dueAt;
      todo.snoozeReason = body.snoozeReason;
      todo.snoozeCount = (todo.snoozeCount || 0) + 1;
      todo.snoozedBy = req.user!.id;
    }
    todo.dueAt = body.dueAt;
  }
  if (body.related !== undefined) todo.related = body.related;
  if (body.pinState !== undefined) {
    todo.pinState = body.pinState;
  }
  if (typeof body.sortOrder === "number") {
    todo.sortOrder = body.sortOrder;
  }
  if (body.historyAt !== undefined) {
    todo.historyAt = body.historyAt;
  }
  if (body.historyAt === undefined && shouldArchiveTodo(todo)) {
    todo.historyAt = new Date().toISOString();
    todo.status = "pending";
    todo.pinState = "";
  }
  await store.persist();
  if (typeof body.done === "boolean") await synchronizeWhatsAppFollowup(todo, req.user!, body.done ? "completed" : "pending");
  res.json({ todo });
}));


app.post("/api/todos/reorder", requireAuth, asyncRoute(async (req, res) => {
  const schema = z.object({
    ids: z.array(z.string()).min(1),
    mode: z.enum(["manual", "top", "bottom"]).default("manual"),
    targetId: z.string().optional()
  });
  const body = schema.parse(req.body);
  const store = getStore();
  const visibleTodos = store.todos.filter((todo) => canSeePersonalData(req.user!, todo.ownerId));
  const selected = body.ids.map((id) => visibleTodos.find((todo) => todo.id === id));
  if (selected.some((todo) => !todo)) {
    res.status(404).json({ message: "待办不存在" });
    return;
  }
  selected.forEach((todo, index) => {
    if (!todo) return;
    todo.sortOrder = index + 1;
    if (body.mode === "manual") {
      todo.pinState = "";
    } else if (todo.id === body.targetId) {
      todo.pinState = body.mode;
    }
  });
  await store.persist();
  res.json({ todos: selected.filter(Boolean) });
}));


app.delete("/api/todos/:id", requireAuth, asyncRoute(async (req, res) => {
  const store = getStore();
  const index = store.todos.findIndex((item) => item.id === req.params.id);
  const todo = index >= 0 ? store.todos[index] : null;
  if (!todo || !canSeePersonalData(req.user!, todo.ownerId)) {
    res.status(404).json({ message: "待办不存在" });
    return;
  }
  if(pendingPurchaseInvoiceTodo(todo,store.purchaseOrders)){res.status(409).json({message:"该采购单尚未补齐开票日期和发票，请在采购订单中补充；待办会自动完成，不能手动删除或归档"});return;}
  if(pendingOutboundPaymentTodo(todo,store.outboundOrders)){res.status(409).json({message:"请在出库订单中由财务确认尾款，不能直接删除、归档或完成此待办"});return;}
  if(pendingSalesInvoiceTodo(todo,store.monthlySalesRecords)){res.status(409).json({message:"该销售单尚未登记开票，请在销售订单中更新开票状态；不能直接删除或归档开票待办"});return;}
  if (todo.reminderRuleId) {
    res.status(400).json({ message: "跟进提醒需完成或标记无需处理，不能直接删除" });
    return;
  }
  store.todos.splice(index, 1);
  await store.persist();
  res.json({ ok: true, id: req.params.id });
}));


app.get("/api/dashboard/summary", requireAuth, (req, res) => {
  // Business scope follows role authorization; personal todos stay scoped independently.
  const store = getStore();
  const customerTargetsChanged = syncMonthlyCustomerTargetTodos(store.monthlySalesTargets,store.customers,store.todos);
  const archived = archiveExpiredTodos(store.todos, new Date());
  if (archived.length || customerTargetsChanged) void store.persist();
  const { customers, todos, deals, reminders, knowledgeAssets, exams, wecomMessages, leads } = store;
  const scopedCustomers = customers.filter((customer) => canSeeOwner(req.user!, customer.ownerId, customer.teamId));
  const scopedLeads = leads.filter((lead) => canSeeOwner(req.user!, lead.ownerId, lead.teamId));
  const activeLeads = scopedLeads.filter((lead) => !lead.deletedAt && lead.status !== "invalid");
  const filteredLeads = scopedLeads.filter((lead) => Boolean(lead.deletedAt) || lead.status === "invalid");
  const pendingCleanLeads = activeLeads.filter((lead) => lead.status === "new");
  const validLeads = activeLeads.filter((lead) => lead.status === "following" || lead.status === "converted");
  const customerLeads = activeLeads.filter((lead) => Boolean(lead.convertedCustomerId));
  const dealLeads = activeLeads.filter((lead) => Boolean(lead.convertedDealId));
  const chinaDateKey = (value: string | Date) => new Date(value).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const todayKey = chinaDateKey(new Date());
  const todayLeadCount = activeLeads.filter((lead) => chinaDateKey(lead.createdAt) === todayKey).length;
  const leadFunnelCounts = [
    { key: "entered", label: "进入系统", count: activeLeads.length },
    { key: "pending", label: "待清洗", count: pendingCleanLeads.length },
    { key: "valid", label: "有效线索", count: validLeads.length },
    { key: "customer", label: "已转客户", count: customerLeads.length },
    { key: "deal", label: "已建商机", count: dealLeads.length }
  ];
  const scopedTodos = todos.filter((todo) => canSeePersonalData(req.user!, todo.ownerId));
  const scopedDeals = deals.filter((deal) => canSeeOwner(req.user!, deal.ownerId, deal.teamId) && !deal.archivedAt && deal.stage !== "成交" && deal.stage !== "丢单");
  const scopedReminders = reminders.filter((reminder) => reminder.teamId === req.user!.teamId && canSeePersonalData(req.user!, reminder.ownerId));
  const scopedSalesOrders = store.monthlySalesRecords.filter((item) => item.sourceType === "manual" && !item.voidedAt && canViewSalesOrder(req.user!, item));
  const scopedPurchaseOrders = store.purchaseOrders.filter((item) => !item.voidedAt && canViewPurchaseOrder(req.user!, item));
  const scopedOutboundOrders = store.outboundOrders.filter((item) => !item.voidedAt && canViewOutboundOrder(req.user!, item));
  const scopedKnowledge = knowledgeAssets.filter((asset) => canSeeKnowledgeAsset(req.user!, asset));
  const scopedMessages = wecomMessages.filter((message) => canSeeOwner(req.user!, message.ownerId, message.teamId));
  const scopedExams = exams.filter((exam) => canAccessExam(req.user!, exam));
  const scopedExamReport = examReport(req.user!);
  const addDateKeyDays = (dateKey: string, days: number) => {
    const [year, month, day] = dateKey.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return date.toISOString().slice(0, 10);
  };
  const [todayYear, todayMonth] = todayKey.split("-").map(Number);
  const todayWeekday = new Date(`${todayKey}T12:00:00+08:00`).getUTCDay();
  const weekStartKey = addDateKeyDays(todayKey, -(todayWeekday === 0 ? 6 : todayWeekday - 1));
  const weekEndKey = addDateKeyDays(weekStartKey, 6);
  const monthStartKey = `${todayKey.slice(0, 7)}-01`;
  const monthEndKey = new Date(Date.UTC(todayYear, todayMonth, 0)).toISOString().slice(0, 10);
  const dateQueryPattern = /^\d{4}-\d{2}-\d{2}$/u;
  const customStartKey = typeof req.query.start === "string" && dateQueryPattern.test(req.query.start) ? req.query.start : todayKey;
  const customEndKey = typeof req.query.end === "string" && dateQueryPattern.test(req.query.end) ? req.query.end : todayKey;
  if (customStartKey > customEndKey) { res.status(400).json({ message: "开始时间不能晚于结束时间" }); return; }
  const activeTodos = scopedTodos.filter((todo) => !isHistoricalTodo(todo));
  const pendingTodos = activeTodos.filter((todo) => !todo.done);
  const overdueTodos = pendingTodos.filter((todo) => todo.priority === "high");
  const historyTodos = scopedTodos.filter(isHistoricalTodo);
  const riskCustomers = scopedCustomers.filter((customer) => {
    const reminderTime = Date.parse(customer.nextReminder || "");
    return customer.nextReminder.includes("逾期") || (Number.isFinite(reminderTime) && reminderTime < Date.now());
  });
  const riskAmount = riskCustomers.reduce((sum, customer) => sum + customer.amount, 0);
  const forecastAmount = scopedDeals.reduce((sum, deal) => sum + deal.amount, 0);
  const wecomBound = scopedCustomers.filter((customer) => customer.wecomBound).length;
  const pendingKnowledge = scopedKnowledge.filter((asset) => asset.status !== "published");
  const publishedExams = scopedExams.filter((exam) => exam.status === "published");
  const averagePassRate = scopedExamReport.totalAttempts ? Math.round((scopedExamReport.passedAttempts / scopedExamReport.totalAttempts) * 100) : 0;
  const pendingMessages = scopedMessages.filter((message) => message.status === "pending");
  const dashboardScope = req.user!.iamDataScope;
  const activeTeamOwnerIds = new Set(store.users
    .filter((user) => user.status === "active" && user.teamId === req.user!.teamId)
    .map((user) => user.id));
  const hasFullTeamDashboardScope = Boolean(dashboardScope?.tenantWide)
    || Boolean(dashboardScope?.ownerIds.length && [...activeTeamOwnerIds].every((ownerId) => dashboardScope.ownerIds.includes(ownerId)));
  const readyDeals = scopedDeals.filter((deal) => ["已报价", "样品", "谈判"].includes(deal.stage));
  const topTodos = [...pendingTodos].sort((a, b) => (b.impactAmount || 0) - (a.impactAmount || 0) || priorityWeight(b.priority) - priorityWeight(a.priority)).slice(0, 3);
  const priorityTasks = buildPriorityTasks(scopedDeals, scopedCustomers, pendingTodos);
  const pipelineHealth = buildPipelineHealth(scopedDeals, scopedCustomers);
  const todoDueDateKey = (dueAt: string) => {
    const value = dueAt.trim();
    const explicitDate = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (explicitDate) return explicitDate[1];
    if (value.includes("后天")) return addDateKeyDays(todayKey, 2);
    if (value.includes("明天")) return addDateKeyDays(todayKey, 1);
    if (value.includes("今天") || /^\d{1,2}:\d{2}$/.test(value)) return todayKey;
    const weekDay = value.match(/本周([一二三四五六日天])/);
    if (weekDay) {
      const dayIndex = "一二三四五六日天".indexOf(weekDay[1]);
      return addDateKeyDays(weekStartKey, Math.min(dayIndex, 6));
    }
    return "";
  };
  const buildPeriodSummary = (label: string, start: string, end: string) => {
    const expectedDeals = scopedDeals.filter((deal) => {
      if (!deal.expectedCloseAt) return false;
      const expectedDateKey = chinaDateKey(deal.expectedCloseAt);
      return expectedDateKey >= start && expectedDateKey <= end;
    });
    const periodTodos = pendingTodos.filter((todo) => {
      const dueDateKey = todoDueDateKey(todo.dueAt);
      return dueDateKey >= start && dueDateKey <= end;
    });
    const highPriorityTodos = periodTodos.filter((todo) => todo.priority === "high");
    const reminderCustomers = scopedCustomers.filter((customer) => {
      const reminderDateKey = todoDueDateKey(customer.nextReminder || "");
      return reminderDateKey >= start && reminderDateKey <= end;
    });
    const intentCustomers = scopedCustomers.filter((customer) => customer.lifecycleStatus === "intent");
    const newLeads = activeLeads.filter((lead) => {
      const createdDateKey = chinaDateKey(lead.createdAt);
      return createdDateKey >= start && createdDateKey <= end;
    });
    const expectedAmounts = reportMoneyRows(expectedDeals);
    const title = highPriorityTodos.length
      ? `${label}最该优先处理 ${highPriorityTodos.length} 个高优先级待办。`
      : reminderCustomers.length
        ? `${label}有 ${reminderCustomers.length} 个客户到达提醒时间。`
        : `${label}暂无紧急提醒，可继续完善客户资料和跟进记录。`;
    const description = riskCustomers.length
      ? `${riskCustomers.slice(0, 3).map((customer) => customer.company).join("、")} 等客户的提醒已逾期。`
      : intentCustomers.length
        ? `当前共有 ${intentCustomers.length} 个意向客户，可按需求和采购频率安排联系。`
        : `${label}客户提醒安排正常。`;
    const action = highPriorityTodos.length
      ? `建议动作：先完成高优先级待办，再处理到期客户提醒并记录沟通结果。`
      : reminderCustomers.length
        ? `建议动作：按提醒时间逐一联系客户，并把结果写入跟进记录。`
        : `建议动作：补齐重点客户的需求、常买产品和下次提醒时间。`;
    return {
      label,
      start,
      end,
      expectedDeals: expectedDeals.length,
      expectedAmounts,
      pendingTodos: periodTodos.length,
      highPriorityTodos: highPriorityTodos.length,
      newLeads: newLeads.length,
      briefing: {
        title,
        description,
        basis: `依据：${periodTodos.length} 个周期待办、${highPriorityTodos.length} 个高优先级待办、${reminderCustomers.length} 个到期提醒、${intentCustomers.length} 个意向客户。`,
        action,
        impact: reminderCustomers.length
          ? `业务影响：按时跟进可减少客户遗漏，并为后续销售订单保留完整依据。`
          : `业务影响：持续完善客户资料，有助于后续需求匹配和复购跟进。`
      }
    };
  };
  const periods = {
    today: buildPeriodSummary("今日", todayKey, todayKey),
    week: buildPeriodSummary("本周", weekStartKey, weekEndKey),
    month: buildPeriodSummary("本月", monthStartKey, monthEndKey),
    custom: buildPeriodSummary("自定义", customStartKey, customEndKey)
  };
  const typeRows = ["customer", "knowledge", "exam", "ocr", "other"].map((type) => {
    const items = pendingTodos.filter((todo) => todo.type === type);
    return {
      type,
      label: todoTypeLabel(type),
      count: items.length,
      risk: items.some((todo) => todo.priority === "high") ? "高" : items.some((todo) => todo.priority === "medium") ? "中" : "普通"
    };
  }).filter((row) => row.count > 0);
  const weekLoad = ["一", "二", "三", "四", "五", "六", "日"].map((day, index) => ({
    day,
    count: pendingTodos.filter((_, todoIndex) => todoIndex % 7 === index).length + (index < Math.min(pendingTodos.length, 7) ? 1 : 0)
  }));
  const topRiskNames = riskCustomers.slice(0, 3).map((customer) => customer.company).join("、") || "暂无逾期客户";
  const businessScopeLabel = hasFullTeamDashboardScope
    ? "本团队业务"
    : (dashboardScope?.ownerIds.length || 0) > 1 ? "授权组织业务" : "本人业务";
  const orderRows = scopedSalesOrders.map((sales) => {
    // Show linked progress even when this role cannot open the purchase ledger; no cost or attachments are returned here.
    const purchase = store.purchaseOrders.find((item) => item.id === sales.purchaseOrderId && item.teamId === sales.teamId);
    const outbound = scopedOutboundOrders.find((item) => item.salesOrderId === sales.id);
    const stage = !purchase ? "待采购"
      : purchase.approvalStatus === "已驳回" ? "采购已驳回"
        : purchase.approvalStatus !== "已通过" ? "采购待审批"
          : sales.approvalStatus === "已驳回" ? "销售已驳回"
            : sales.approvalStatus !== "已通过" ? "销售待审批"
              : !outbound ? "待出库"
                : outboundOrderStatus(outbound, sales) === "待审批" ? "出库待审批" : outboundOrderStatus(outbound, sales);
    return {
      id: sales.id, salesOrderNo: sales.orderNo || "", purchaseOrderNo: purchase?.orderNo || "", outboundOrderNo: outbound?.orderNo || "",
      customer: sales.customerName, owner: store.users.find((item) => item.id === sales.ownerId)?.name || "--", amount: sales.salesAmount,
      stage, approvalInstanceId: outbound?.approvalInstanceId || sales.approvalInstanceId || purchase?.approvalInstanceId || "", updatedAt: outbound?.updatedAt || sales.updatedAt
    };
  });
  const linkedPurchaseIds = new Set(scopedSalesOrders.map((item) => item.purchaseOrderId).filter(Boolean));
  scopedPurchaseOrders.filter((item) => !linkedPurchaseIds.has(item.id)).forEach((purchase) => orderRows.push({
    id: purchase.id, salesOrderNo: "", purchaseOrderNo: purchase.orderNo, outboundOrderNo: "", customer: purchase.supplierName,
    owner: purchase.purchaserName || store.users.find((item) => item.id === purchase.purchaserId)?.name || "--", amount: purchase.totalAmount,
    stage: purchase.approvalStatus === "已通过" ? "采购待关联" : purchase.approvalStatus === "已驳回" ? "采购已驳回" : "采购待审批",
    approvalInstanceId: purchase.approvalInstanceId || "", updatedAt: purchase.updatedAt
  }));
  const orderStageCounts = [...new Set(orderRows.map((item) => item.stage))].map((stage) => ({ stage, count: orderRows.filter((item) => item.stage === stage).length }));
  const userName = (userId: string) => store.users.find((item) => item.id === userId)?.name || userId || "未分配";
  const inDateRange = (value: string | undefined, start: string, end: string) => {
    if (!value) return false;
    const key = /^\d{4}-\d{2}-\d{2}/u.test(value) ? value.slice(0, 10) : chinaDateKey(value);
    return key >= start && key <= end;
  };
  const elapsedDays = Math.max(1, Number(todayKey.slice(8, 10)));
  const monthDays = Number(monthEndKey.slice(8, 10));
  const taskRow = (key: string, label: string, actual: number, target: number, unit: string, canProject: boolean) => {
    const projected = canProject ? Math.round((actual / elapsedDays) * monthDays * 100) / 100 : actual;
    const progress = target > 0 ? Math.min(999, Math.round((actual / target) * 100)) : 0;
    return {
      key, label, unit, target, completed: Math.round(actual * 100) / 100, remaining: Math.max(0, Math.round((target - actual) * 100) / 100),
      projected, progress, status: target <= 0 ? "未设置目标" : actual >= target ? "已达成" : projected >= target ? "预计可达成" : "存在差距"
    };
  };
  const monthKeysBetween = (start: string, end: string) => {
    const rows: string[] = [];
    let year = Number(start.slice(0, 4)); let month = Number(start.slice(5, 7));
    const endYear = Number(end.slice(0, 4)); const endMonth = Number(end.slice(5, 7));
    while (year < endYear || (year === endYear && month <= endMonth)) {
      rows.push(`${year}-${String(month).padStart(2, "0")}`);
      month += 1; if (month > 12) { month = 1; year += 1; }
      if (rows.length > 120) break;
    }
    return rows;
  };
  const buildDataBoard = (label: string, start: string, end: string) => {
    const periodCustomers = scopedCustomers.filter((item) => inDateRange(item.createdAt, start, end));
    const periodActivities = store.customerActivities.filter((item) => inDateRange(item.createdAt, start, end)
      && scopedCustomers.some((customer) => customer.id === item.customerId));
    const periodSales = scopedSalesOrders.filter((item) => inDateRange(item.createdAt, start, end));
    const periodPurchases = scopedPurchaseOrders.filter((item) => inDateRange(item.purchaseDate || item.createdAt, start, end));
    const periodOutbound = scopedOutboundOrders.filter((item) => inDateRange(item.outboundDate || item.createdAt, start, end));
    const visibleUserIds = new Set([
      ...periodCustomers.map((item) => item.ownerId), ...periodCustomers.map((item) => item.createdById || ""),
      ...periodActivities.map((item) => item.operatorId), ...periodSales.map((item) => item.ownerId),
      ...periodPurchases.map((item) => item.purchaserId), ...periodOutbound.map((item) => item.ownerId)
    ].filter(Boolean));
    const customerRows = [...visibleUserIds].map((ownerId) => {
      const owned = scopedCustomers.filter((item) => item.ownerId === ownerId);
      const added = periodCustomers.filter((item) => (item.createdById || item.ownerId) === ownerId);
      const ownedIds = new Set(owned.map((item) => item.id));
      const sales = periodSales.filter((item) => item.ownerId === ownerId);
      return {
        ownerId, owner: userName(ownerId), imported: added.filter((item) => item.recordOrigin === "import").length,
        manual: added.filter((item) => item.recordOrigin !== "import").length,
        followUps: periodActivities.filter((item) => item.operatorId === ownerId || ownedIds.has(item.customerId)).length,
        open: owned.filter((item) => (item.lifecycleStatus || "open") === "open").length,
        intent: owned.filter((item) => item.lifecycleStatus === "intent").length,
        won: owned.filter((item) => item.lifecycleStatus === "won").length,
        salesOrders: sales.length, salesAmount: sales.reduce((sum, item) => sum + item.salesAmount, 0)
      };
    }).filter((item) => item.imported || item.manual || item.followUps || item.open || item.intent || item.won || item.salesOrders)
      .sort((a, b) => b.followUps - a.followUps || b.salesAmount - a.salesAmount);
    const purchaserIds = [...new Set(periodPurchases.map((item) => item.purchaserId))];
    const purchaseRows = purchaserIds.map((purchaserId) => {
      const rows = periodPurchases.filter((item) => item.purchaserId === purchaserId);
      return { purchaserId, purchaser: rows[0]?.purchaserName || userName(purchaserId), orders: rows.length,
        quantity: rows.reduce((sum, item) => sum + item.quantity, 0), weight: rows.reduce((sum, item) => sum + item.weight, 0),
        amount: rows.reduce((sum, item) => sum + item.totalAmount, 0), products: [...new Set(rows.map((item) => item.productName).filter(Boolean))].join("、") };
    }).sort((a, b) => b.amount - a.amount);
    const productRows = [...new Set(periodPurchases.map((item) => item.productName).filter(Boolean))].map((product) => {
      const rows = periodPurchases.filter((item) => item.productName === product);
      return { product, orders: rows.length, quantity: rows.reduce((sum, item) => sum + item.quantity, 0),
        weight: rows.reduce((sum, item) => sum + item.weight, 0), amount: rows.reduce((sum, item) => sum + item.totalAmount, 0) };
    }).sort((a, b) => b.amount - a.amount);
    const outboundOwnerIds = [...new Set(periodOutbound.map((item) => item.ownerId))];
    const outboundRows = outboundOwnerIds.map((ownerId) => {
      const rows = periodOutbound.filter((item) => item.ownerId === ownerId);
      const linkedSales = rows.map((row) => scopedSalesOrders.find((item) => item.id === row.salesOrderId)).filter(Boolean) as MonthlySalesRecord[];
      return { ownerId, owner: userName(ownerId), orders: rows.length,
        pending: rows.filter((item) => outboundState(item) === "待财务确认").length,
        transit: rows.filter((item) => !["待财务确认", "已完结", "已作废"].includes(outboundState(item))).length,
        received: rows.filter((item) => outboundState(item) === "已完结").length,
        weight: linkedSales.reduce((sum, item) => sum + Number(item.weight || 0), 0),
        salesAmount: linkedSales.reduce((sum, item) => sum + item.salesAmount, 0),
        receivedAmount: rows.reduce((sum, item) => sum + (item.financeConfirmedAt ? item.financeConfirmedAmount || 0 : 0), 0) };
    }).sort((a, b) => b.orders - a.orders || b.receivedAmount - a.receivedAmount);
    const targetMonths = monthKeysBetween(start, end);
    const targetRows = store.monthlySalesTargets.filter((item) => item.teamId === req.user!.teamId && targetMonths.includes(item.month) && canSeeOwner(req.user!, item.ownerId, item.teamId));
    const targetMonthSales = scopedSalesOrders.filter((item) => targetMonths.includes(salesOrderMonth(item.createdAt)));
    const taskOwnerIds = [...new Set([...targetRows.map((item) => item.ownerId), ...targetMonthSales.map((item) => item.ownerId)])];
    const canProject = targetMonths.length === 1 && targetMonths[0] === todayKey.slice(0, 7);
    const salesTaskRows = taskOwnerIds.map((ownerId) => {
      const target = targetRows.filter((item) => item.ownerId === ownerId).reduce((sum, item) => sum + item.targetAmount, 0);
      const actual = targetMonthSales.filter((item) => item.ownerId === ownerId).reduce((sum, item) => sum + item.salesAmount, 0);
      return taskRow(ownerId, userName(ownerId), actual, target, "元", canProject);
    }).sort((a, b) => b.progress - a.progress || b.completed - a.completed);
    const salesTargetAmount = salesTaskRows.reduce((sum, item) => sum + item.target, 0);
    const completedSalesAmount = salesTaskRows.reduce((sum, item) => sum + item.completed, 0);
    const customerTaskRows = customerMonthlyTargetProgress(store.customers,targetRows,start,end,todayKey).map(item=>({...item,label:userName(item.ownerId)}));
    return {
      label, start, end,
      taskAchievement: {
        month: targetMonths.length > 1 ? `${targetMonths[0]} 至 ${targetMonths[targetMonths.length - 1]}` : targetMonths[0] || start.slice(0, 7),
        rows: salesTaskRows,
        customerRows: customerTaskRows,
        actuals: { salespeople: salesTaskRows.filter((item) => item.target > 0).length, targetAmount: salesTargetAmount, completedAmount: completedSalesAmount, overallProgress: salesTargetAmount > 0 ? Math.round(completedSalesAmount / salesTargetAmount * 1000) / 10 : 0 }
      },
      customers: { totals: { added: periodCustomers.length, imported: periodCustomers.filter((item) => item.recordOrigin === "import").length, followUps: periodActivities.length, salesAmount: periodSales.reduce((sum, item) => sum + item.salesAmount, 0) }, rows: customerRows },
      orders: { total: orderRows.filter((item) => inDateRange(item.updatedAt, start, end)).length, counts: orderStageCounts, rows: orderRows.filter((item) => inDateRange(item.updatedAt, start, end)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100) },
      purchases: { totals: { orders: periodPurchases.length, quantity: periodPurchases.reduce((sum, item) => sum + item.quantity, 0), weight: periodPurchases.reduce((sum, item) => sum + item.weight, 0), amount: periodPurchases.reduce((sum, item) => sum + item.totalAmount, 0) }, rows: purchaseRows, products: productRows },
      outbound: { totals: { orders: periodOutbound.length, transit: periodOutbound.filter((item) => !["待财务确认", "已完结", "已作废"].includes(outboundState(item))).length, received: periodOutbound.filter((item) => outboundState(item) === "已完结").length, receivedAmount: periodOutbound.reduce((sum, item) => sum + (item.financeConfirmedAt ? item.financeConfirmedAmount || 0 : 0), 0) }, rows: outboundRows }
    };
  };
  const dataBoards = {
    today: buildDataBoard("今日", todayKey, todayKey),
    week: buildDataBoard("本周", weekStartKey, weekEndKey),
    month: buildDataBoard("本月", monthStartKey, monthEndKey),
    custom: buildDataBoard("自定义", customStartKey, customEndKey)
  };
  res.json({
    scope: hasFullTeamDashboardScope
      ? "本团队业务数据，本人待办"
      : (dashboardScope?.ownerIds.length || 0) > 1 ? "授权组织业务数据，本人待办" : "本人业务数据，本人待办",
    scopeLabels: {
      business: businessScopeLabel,
      todos: "本人待办"
    },
    updatedAt: new Date().toISOString(),
    availableBoards: availableDashboardBoards(req.user!),
    workbench: buildWorkbenchOverview(req.user!, store, { customers: scopedCustomers, todos: pendingTodos, sales: scopedSalesOrders, purchases: scopedPurchaseOrders, outbound: scopedOutboundOrders, scope: businessScopeLabel, today: todayKey }),
    dataBoards,
    orderWorkflow: { total: orderRows.length, counts: orderStageCounts, rows: orderRows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100) },
    periods,
    briefing: {
      title: pendingTodos.length
        ? `今天最该处理的是 ${pendingTodos.length} 个待办，其中 ${overdueTodos.length} 个属于高优先级。`
        : "今天暂无未完成待办，可以复盘客户资料和销售知识库。",
      description: riskCustomers.length
        ? `系统根据提醒时间和待办状态计算，建议优先联系 ${topRiskNames}。`
        : `当前没有逾期客户提醒，建议继续跟进意向客户并记录沟通结果。`,
      basis: `依据：${pendingTodos.length} 个未完成待办、${riskCustomers.length} 个逾期客户、${scopedCustomers.filter((customer) => customer.lifecycleStatus === "intent").length} 个意向客户。`,
      action: overdueTodos.length
        ? `建议动作：先处理 ${overdueTodos.length} 个高优先级待办，再依次联系逾期客户。`
        : `建议动作：按今日节奏完成待办，并为已联系客户更新跟进记录和提醒时间。`,
      impact: riskAmount
        ? `影响范围：${riskCustomers.length} 个逾期客户，处理后可降低漏跟和重复联系。`
        : `影响范围：当前客户提醒正常，可集中完善需求、常买产品和采购频率。`,
      riskAmount,
      riskLabel: hasFullTeamDashboardScope
        ? "团队风险金额"
        : (dashboardScope?.ownerIds.length || 0) > 1 ? "授权组织风险金额" : "本人名下风险",
      closableDeals: readyDeals.length,
      closableAmount: readyDeals.reduce((sum, deal) => sum + deal.amount, 0),
      unreadWecom: pendingMessages.length
    },
    metrics: {
      customers: scopedCustomers.length,
      riskCustomers: riskCustomers.length,
      todos: pendingTodos.length,
      overdueTodos: overdueTodos.length,
      forecastAmount,
      wecomBoundRate: scopedCustomers.length ? Math.round((wecomBound / scopedCustomers.length) * 100) : 0,
      pendingKnowledge: pendingKnowledge.length,
      examPassRate: averagePassRate,
      unfinishedExams: canManageTraining(req.user) ? scopedExams.filter((exam) => exam.status !== "published").length : scopedExams.filter((exam) => exam.status === "published" && !store.examAttempts.some((attempt) => attempt.examId === exam.id && attempt.userId === req.user!.id && attempt.passed)).length,
      customerCompleteness: scopedCustomers.length ? Math.round(scopedCustomers.reduce((sum, customer) => sum + (customer.contact ? 25 : 0) + (customer.country ? 25 : 0) + (customer.stage ? 25 : 0) + (customer.nextReminder ? 25 : 0), 0) / scopedCustomers.length) : 0
    },
    schedule: topTodos.map((todo) => ({
      time: todo.dueAt || "待定",
      title: todo.title,
      subtitle: todo.related || todoTypeLabel(todo.type),
      tone: todo.priority === "high" ? "red" : todo.priority === "medium" ? "amber" : "green"
    })),
    quality: {
      followHealth: scopedCustomers.length ? Math.round(scopedCustomers.reduce((sum, customer) => sum + customer.health, 0) / scopedCustomers.length) : 0,
      overdueRate: pendingTodos.length ? Math.round((overdueTodos.length / pendingTodos.length) * 100) : 0,
      avgResponseHours: Number((Math.max(1, pendingMessages.length + scopedReminders.filter((reminder) => reminder.enabled !== false).length) * 1.6).toFixed(1))
    },
    leadFunnel: {
      stages: leadFunnelCounts.map((stage, index) => ({
        ...stage,
        conversionRate: index === 0
          ? 100
          : leadFunnelCounts[0].count
            ? Math.round((stage.count / leadFunnelCounts[0].count) * 100)
            : 0
      })),
      todayAdded: todayLeadCount,
      filteredOut: filteredLeads.length,
      dealConversionRate: activeLeads.length ? Math.round((dealLeads.length / activeLeads.length) * 100) : 0
    },
    pipelineHealth,
    todoInsights: {
      total: pendingTodos.length,
      overdue: overdueTodos.length,
      completionRate: activeTodos.length ? Math.round((activeTodos.filter((todo) => todo.done).length / activeTodos.length) * 100) : 0,
      impactAmount: pendingTodos.reduce((sum, todo) => sum + (todo.impactAmount || 0), 0),
      typeRows,
      weekLoad,
      historyCount: historyTodos.length,
      historyAmount: historyTodos.reduce((sum, todo) => sum + (todo.impactAmount || 0), 0)
    },
    priorityTasks: priorityTasks.map(({ deal, customer, score, reason, action, tone }) => ({
      id: deal.id,
      customerId: customer?.id || deal.customerId,
      title: deal.title,
      subtitle: `${customer?.country || "未知国家"} · ${deal.stage} · ${moneyText(deal.amount)} · ${deal.nextAction}`,
      score,
      reason,
      action,
      tone,
      badge: customer?.nextReminder.includes("逾期") ? "逾期" : deal.stage
    }))
  });
});


app.get("/api/dashboard/leaderboard", requireAuth, (req, res) => {
  const store = getStore();
  const periodParam = String(req.query.period || "week");
  const periodDays = periodParam === "month" ? 30 : periodParam === "quarter" ? 90 : periodParam === "year" ? 365 : 7;
  const periodLabel = periodParam === "month" ? "近30天" : periodParam === "quarter" ? "近90天" : periodParam === "year" ? "近365天" : "近7天";
  const windowStart = Date.now() - periodDays * 24 * 60 * 60 * 1000;
  const prevWindowStart = Date.now() - periodDays * 2 * 24 * 60 * 60 * 1000;
  const users = store.users.filter((user) => user.status === "active" && canSeeOwner(req.user!, user.id, user.teamId));
  const canCompareMembers = users.some((user) => user.id !== req.user!.id);

  const buildEntry = (user: typeof users[number], from: number, to: number) => {
    const userDeals = store.deals.filter((d) => d.ownerId === user.id);
    const wonDeals = userDeals.filter((d) => d.stage === "成交" && new Date(d.stageChangedAt).getTime() >= from && new Date(d.stageChangedAt).getTime() < to);
    const wonAmount = wonDeals.reduce((sum, d) => sum + d.amount, 0);
    const newCustomers = store.leads.filter((l) => l.ownerId === user.id && l.convertedCustomerId && new Date(l.createdAt).getTime() >= from && new Date(l.createdAt).getTime() < to).length;
    const totalDeals = userDeals.filter((d) => d.stage !== "丢单" && !d.archivedAt).length;
    const wonTotal = userDeals.filter((d) => d.stage === "成交").length;
    const conversionRate = totalDeals > 0 ? Math.round((wonTotal / totalDeals) * 100) : 0;
    const followUps = store.dealEvents.filter((e) => {
      const deal = userDeals.find((d) => d.id === e.dealId);
      return deal && new Date(e.createdAt).getTime() >= from && new Date(e.createdAt).getTime() < to;
    }).length;
    const score = Math.round(wonAmount / 1000 + wonDeals.length * 200 + newCustomers * 500 + followUps * 20);
    return { userId: user.id, userName: user.name, avatar: user.avatar, wonAmount, wonCount: wonDeals.length, newCustomers, conversionRate, followUps, score };
  };

  const entries = users.map((user) => {
    const current = buildEntry(user, windowStart, Date.now());
    const prev = buildEntry(user, prevWindowStart, windowStart);
    return { ...current, prevWonAmount: prev.wonAmount };
  });

  entries.sort((a, b) => b.wonAmount - a.wonAmount || b.newCustomers - a.newCustomers || b.score - a.score);
  const ranked = entries.map((e, i) => ({ ...e, rank: i + 1 }));

  res.json({
    scope: canCompareMembers ? "授权范围" : "仅本人",
    period: periodLabel,
    entries: canCompareMembers ? ranked : ranked.filter((entry) => entry.userId === req.user!.id)
  });
});


app.get("/api/dashboard/badges", requireAuth, (req, res) => {
  const store = getStore();
  const user = req.user!;
  const userDeals = store.deals.filter((d) => d.ownerId === user.id);
  const userCustomers = store.customers.filter((c) => c.ownerId === user.id);
  const userEvents = store.dealEvents.filter((e) => userDeals.some((d) => d.id === e.dealId));

  const wonDeals = userDeals.filter((d) => d.stage === "成交");
  const firstWon = wonDeals.length >= 1;
  const weekFollowUps = userEvents.filter((e) => new Date(e.createdAt).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000).length;
  const streak7 = weekFollowUps >= 7;
  const monthWon = wonDeals.filter((d) => new Date(d.stageChangedAt).getMonth() === new Date().getMonth()).length;
  const isMonthlyChamp = monthWon >= 3;
  const customerCount = userCustomers.length;
  const isExplorer = customerCount >= 20;
  const sampleDeals = userDeals.filter((d) => d.stage === "样品" || d.stage === "谈判" || d.stage === "成交");
  const isSampleMaster = sampleDeals.length >= 5;
  const totalAmount = wonDeals.reduce((sum, d) => sum + d.amount, 0);
  const isMillionaire = totalAmount >= 100000;
  const bigDeal = wonDeals.some((d) => d.amount >= 50000);
  const fastCloser = wonDeals.some((d) => {
    const createdEvent = userEvents.find((e) => e.dealId === d.id && e.type === "created");
    const created = createdEvent ? new Date(createdEvent.createdAt).getTime() : new Date(d.stageChangedAt).getTime();
    const closed = new Date(d.stageChangedAt).getTime();
    return closed - created < 7 * 24 * 60 * 60 * 1000;
  });

  const badges = [
    { id: "first_won", name: "首单达成", icon: "🎯", desc: "完成第一笔成交订单", earned: firstWon, progress: `${wonDeals.length}/1` },
    { id: "streak_7", name: "持续跟进", icon: "🔥", desc: "连续7天有跟进记录", earned: streak7, progress: `${weekFollowUps}/7天` },
    { id: "monthly_champ", name: "月度之星", icon: "⭐", desc: "当月成交3笔以上", earned: isMonthlyChamp, progress: `${monthWon}/3` },
    { id: "explorer", name: "客户开拓者", icon: "🧭", desc: "名下客户达20个", earned: isExplorer, progress: `${customerCount}/20` },
    { id: "sample_master", name: "样品达人", icon: "📦", desc: "推动5个商机进入样品阶段", earned: isSampleMaster, progress: `${sampleDeals.length}/5` },
    { id: "millionaire", name: "十万俱乐部", icon: "💰", desc: "累计成交金额达¥100K", earned: isMillionaire, progress: `¥${Math.round(totalAmount / 1000)}K/¥100K` },
    { id: "big_deal", name: "大单猎手", icon: "🏆", desc: "单笔成交金额超¥50K", earned: bigDeal, progress: bigDeal ? "已达成" : "未达成" },
    { id: "fast_closer", name: "闪电成交", icon: "⚡", desc: "7天内从创建到成交", earned: fastCloser, progress: fastCloser ? "已达成" : "未达成" },
  ];

  res.json({ badges, earnedCount: badges.filter((b) => b.earned).length, totalCount: badges.length });
});


app.post("/api/dashboard/priority-tasks/batch-process", requireAuth, asyncRoute(async (req, res) => {
  const store = getStore();
  const scopedCustomers = store.customers.filter((customer) => canSeeOwner(req.user!, customer.ownerId, customer.teamId));
  const scopedTodos = store.todos.filter((todo) => canSeePersonalData(req.user!, todo.ownerId));
  const pendingTodos = scopedTodos.filter((todo) => !todo.done && !isHistoricalTodo(todo));
  const priorityTasks = scopedCustomers.map((customer) => {
    const overdue = customer.nextReminder.includes("逾期") || (() => {
      const timestamp = new Date(customer.nextReminder.replace(" ", "T")).getTime();
      return Number.isFinite(timestamp) && timestamp < Date.now();
    })();
    const intent = customer.lifecycleStatus === "intent";
    const noActivity = !store.customerActivities.some((activity) => activity.customerId === customer.id);
    const hasTodo = pendingTodos.some((todo) => todo.related.includes(customer.company));
    const score = Math.min(100, (overdue ? 50 : 0) + (intent ? 25 : 0) + (noActivity ? 15 : 0) + (hasTodo ? 10 : 0));
    const action = overdue ? `联系逾期客户：${customer.company}` : intent ? `继续跟进意向客户：${customer.company}` : `完善客户跟进：${customer.company}`;
    return { customer, score, action };
  }).filter((task) => task.score > 0).sort((left, right) => right.score - left.score).slice(0, 5);
  const created: Todo[] = [];
  for (const task of priorityTasks) {
    const exists = store.todos.some((todo) => todo.ownerId === req.user!.id && !todo.done && todo.related === task.customer.company && todo.title.includes("客户跟进"));
    if (exists) continue;
    const todo: Todo = {
      id: `t_customer_follow_${task.customer.id}_${Date.now()}_${created.length}`,
      title: `客户跟进：${task.action}`,
      type: "customer",
      priority: task.score >= 80 ? "high" : task.score >= 60 ? "medium" : "normal",
      dueAt: currentMinuteText(),
      ownerId: req.user!.id,
      teamId: req.user!.teamId,
      related: task.customer.company,
      done: false,
      impactAmount: task.customer.amount || 0,
      createdAt: new Date().toISOString()
    };
    store.todos.unshift(todo);
    created.push(todo);
  }
  await store.persist();
  res.json({ created, processed: priorityTasks.length, skipped: priorityTasks.length - created.length });
}));