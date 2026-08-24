"use client";
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type Direction = "expense" | "refund";
type Category =
  | "预算外支出"
  | "老人住房"
  | "孩子"
  | "保险医疗"
  | "老人赡养"
  | "车辆交通"
  | "食品水果与日用"
  | "水电物业通讯"
  | "自由消费"
  | "其他";

type Transaction = {
  id: string;
  date: string;
  amount: number;
  direction: Direction;
  merchant: string;
  source: string;
  category: Category;
  online?: boolean;
  provisional?: boolean;
  exceptional?: boolean;
  confidence?: "high" | "medium" | "low";
  paymentKind?: "purchase" | "refund" | "transfer" | "income";
  budgetExcluded?: boolean;
};

type Settings = {
  monthlyBudget: number;
  reserveFund: number;
  monthlyInvestment: number;
  weeklyInvestment: number;
  foodLimit: number;
  freeLimit: number;
  onlineLimit: number;
};

type PlannedExpense = {
  id: string;
  title: string;
  amount: number;
  dueDate: string;
  frequency: "once" | "monthly" | "yearly";
  category: Category;
  active: boolean;
  paidOccurrences: string[];
};

const STORAGE_KEY = "zhiyu-finance-v2";
const SETTINGS_KEY = "zhiyu-settings-v3";
const PLANNED_KEY = "zhiyu-planned-v1";
const TRACKING_START = "2026-08-21";
const CYCLE_DAY = 21;
const DEFAULT_SETTINGS: Settings = {
  monthlyBudget: 0,
  reserveFund: 0,
  monthlyInvestment: 0,
  weeklyInvestment: 0,
  foodLimit: 0,
  freeLimit: 0,
  onlineLimit: 0,
};

const DEFAULT_PLANNED: PlannedExpense[] = [];

const normalizeSettings = (value?: Partial<Settings>): Settings => {
  if (!value) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...value,
  };
};

const CATEGORY_LIMITS: Array<{ name: Category; limit: number }> = [
  { name: "老人住房", limit: 0 },
  { name: "孩子", limit: 0 },
  { name: "保险医疗", limit: 0 },
  { name: "老人赡养", limit: 0 },
  { name: "车辆交通", limit: 0 },
  { name: "食品水果与日用", limit: 0 },
  { name: "水电物业通讯", limit: 0 },
  { name: "自由消费", limit: 0 },
];

const QUICK_CATEGORIES: Category[] = ["食品水果与日用", "孩子", "车辆交通", "自由消费", "其他"];

const money = (value: number) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(Math.max(0, value));

const localDate = (date: string) => {
  const d = new Date(date);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

const dayStart = (value: string | Date) => {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00`) : new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const dateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const cycleStartKey = (value: string | Date) => {
  const date = new Date(value);
  const start = new Date(date.getFullYear(), date.getMonth() - (date.getDate() < CYCLE_DAY ? 1 : 0), CYCLE_DAY);
  return dateKey(start);
};

const cycleEndKey = (startKey: string) => {
  const start = dayStart(startKey);
  return dateKey(new Date(start.getFullYear(), start.getMonth() + 1, CYCLE_DAY - 1));
};

const cycleLabel = (startKey: string) => {
  const start = dayStart(startKey);
  const end = dayStart(cycleEndKey(startKey));
  return `${start.getMonth() + 1}.${start.getDate()}–${end.getMonth() + 1}.${end.getDate()}`;
};

const nextCycleStartKey = (startKey: string) => {
  const start = dayStart(startKey);
  return dateKey(new Date(start.getFullYear(), start.getMonth() + 1, CYCLE_DAY));
};

function nextOccurrence(item: PlannedExpense, today = new Date()): string | null {
  if (!item.active) return null;
  const current = dayStart(item.dueDate);
  const start = dayStart(today);
  if (item.frequency === "once") return current >= start && !item.paidOccurrences.includes(item.dueDate) ? item.dueDate : null;
  while (current < start || item.paidOccurrences.includes(dateKey(current))) {
    if (item.frequency === "monthly") current.setMonth(current.getMonth() + 1);
    else current.setFullYear(current.getFullYear() + 1);
  }
  return dateKey(current);
}

const daysUntil = (date: string) => Math.ceil((dayStart(date).getTime() - dayStart(new Date()).getTime()) / 86400000);

const makeId = (parts: Array<string | number>) =>
  parts.join("|").replace(/\s+/g, " ").slice(0, 220);

const parseAmount = (value: string | number) => Number(String(value).replace(/[¥￥,\s]/g, ""));

const normalizeDate = (value: string) => {
  const match = value.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+|T)(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (!match) return new Date(value).toISOString();
  const [, year, month, day, hour, minute, second = "00"] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:${second.padStart(2, "0")}+08:00`;
};

function autoCategory(text: string, source = ""): { category: Category; online: boolean; confidence: "high" | "medium" | "low" } {
  const value = `${text} ${source}`.toLowerCase();
  if (/不计预算|预算外/.test(value)) return { category: "预算外支出", online: false, confidence: "high" };
  if (/房租|老人住房/.test(value)) return { category: "老人住房", online: false, confidence: "high" };
  if (/纸尿裤|拉拉裤|儿童|宝宝|婴儿|童装|早教|滑板车|玩具|摄影/.test(value)) return { category: "孩子", online: false, confidence: "high" };
  if (/保险|好医保|医院|医疗|药|保健|维生素|体检/.test(value)) return { category: "保险医疗", online: false, confidence: "high" };
  if (/赡养|养老/.test(value)) return { category: "老人赡养", online: false, confidence: "high" };
  if (/滴滴|停车|高速|车票|交通|加油|汽油|充电|车辆|哈啰/.test(value)) return { category: "车辆交通", online: false, confidence: "high" };
  if (/物业|水费|电费|燃气|通讯|话费|宽带/.test(value)) return { category: "水电物业通讯", online: false, confidence: "high" };
  if (/超市|山姆|王鲜生|菜店|水果|生鲜|食品|外卖|餐饮|饭|小笼包|烤鸭|水饺|甜品|海鲜|干果|便利|团购|个人转账/.test(value)) {
    return { category: "食品水果与日用", online: false, confidence: "high" };
  }
  if (/抖音|拼多多|淘宝|天猫|京东|购物|美容|口红|护肤|女鞋|内衣|娱乐|apple|会员|生活服务/.test(value)) {
    return { category: "自由消费", online: /抖音|拼多多|淘宝|天猫|京东|购物/.test(value), confidence: "high" };
  }
  if (source.includes("抖音")) return { category: "自由消费", online: true, confidence: "medium" };
  return { category: "其他", online: false, confidence: "low" };
}

const isExceptional = (text: string) => /十三区大师肖像|公证处|住院|手术/.test(text);

function dedupe(items: Transaction[]) {
  const seen = new Map<string, Transaction>();
  for (const item of items) seen.set(item.id, item);
  return Array.from(seen.values()).sort((a, b) => b.date.localeCompare(a.date));
}

const budgetValue = (item: Transaction) => item.budgetExcluded ? 0 : (item.direction === "expense" ? item.amount : -item.amount);

function parseSms(text: string): Transaction | null {
  const match = text.match(/(?:人民币|RMB|CNY|¥|￥)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i)
    ?? text.match(/(?:支出|消费|支付|交易|扣款|退款|转出|转入)[^0-9]{0,16}([0-9,]+(?:\.[0-9]{1,2})?)\s*元?/i)
    ?? text.match(/([0-9,]+(?:\.[0-9]{1,2})?)\s*元/);
  if (!match) return null;
  const amount = parseAmount(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const isRefund = /退款|退回|冲正|撤销交易/.test(text);
  const isIncome = !isRefund && /收入|转入|汇入|入账|到账/.test(text) && !/支出|消费|支付|扣款/.test(text);
  const isTransfer = !isRefund && !isIncome && /转账|转出|汇出|汇款/.test(text);
  const classified = autoCategory(text, "银行短信");
  const category = isTransfer || isIncome ? "其他" : classified.category;
  const paymentKind = isRefund ? "refund" : isIncome ? "income" : isTransfer ? "transfer" : "purchase";
  const date = new Date().toISOString();
  return {
    id: makeId(["短信", date.slice(0, 16), amount, text.slice(0, 36)]),
    date,
    amount,
    direction: isRefund || isIncome ? "refund" : "expense",
    merchant: text.replace(/\s+/g, " ").slice(0, 56),
    source: "银行短信",
    category,
    online: classified.online,
    provisional: classified.confidence !== "high",
    exceptional: false,
    confidence: isTransfer || isIncome ? "high" : classified.confidence,
    paymentKind,
    budgetExcluded: isTransfer || isIncome,
  };
}

async function parseCsv(file: File): Promise<Transaction[]> {
  const Papa = (await import("papaparse")).default;
  const bytes = await file.arrayBuffer();
  let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (!text.includes("记录时间") && !text.includes("交易时间")) {
    text = new TextDecoder("gb18030", { fatal: false }).decode(bytes);
  }
  const matrix = Papa.parse<string[]>(text, { skipEmptyLines: true }).data;
  const headerIndex = matrix.findIndex((row) => row.includes("记录时间") || row.includes("交易时间"));
  if (headerIndex < 0) throw new Error("没有找到可识别的账单表头");
  const headers = matrix[headerIndex];
  const index = (name: string) => headers.indexOf(name);
  const results: Transaction[] = [];
  for (const row of matrix.slice(headerIndex + 1)) {
    const date = row[index("记录时间")] || row[index("交易时间")];
    const directionText = row[index("收支类型")] || row[index("收/支")];
    const amount = parseAmount(row[index("金额")] || row[index("金额(元)")]);
    if (!date || !Number.isFinite(amount)) continue;
    if (directionText !== "支出" && !String(directionText).includes("退款")) continue;
    const merchant = row[index("备注")] || row[index("交易对方")] || "未识别交易";
    const originalCategory = row[index("分类")] || "";
    const { category, online } = autoCategory(`${originalCategory} ${merchant}`, "支付宝记账本");
    const normalizedDate = normalizeDate(date);
    results.push({
      id: makeId(["支付宝记账本", normalizedDate, amount, merchant]),
      date: normalizedDate,
      amount,
      direction: directionText === "支出" ? "expense" : "refund",
      merchant: merchant.slice(0, 72),
      source: "支付宝记账本",
      category,
      online,
      exceptional: isExceptional(merchant),
      confidence: "high",
      paymentKind: directionText === "支出" ? "purchase" : "refund",
    });
  }
  return results;
}

async function parseXlsx(file: File): Promise<Transaction[]> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, raw: false });
  const headerIndex = matrix.findIndex((row) => row.includes("交易时间"));
  if (headerIndex < 0) throw new Error("没有找到微信账单表头");
  const headers = matrix[headerIndex].map(String);
  const index = (name: string) => headers.indexOf(name);
  const results: Transaction[] = [];
  for (const row of matrix.slice(headerIndex + 1)) {
    const cells = row.map((cell) => String(cell ?? ""));
    const dateText = cells[index("交易时间")];
    const directionText = cells[index("收/支")];
    const status = cells[index("当前状态")];
    const amount = parseAmount(cells[index("金额(元)")]);
    if (!dateText || !Number.isFinite(amount) || /等待|关闭|撤销/.test(status)) continue;
    const isRefund = directionText === "收入" && status.includes("退款");
    if (directionText !== "支出" && !isRefund) continue;
    if (directionText === "支出" && status.includes("已全额退款")) continue;
    const type = cells[index("交易类型")];
    const counterparty = cells[index("交易对方")];
    const product = cells[index("商品")];
    const safeMerchant = type === "转账" ? "团购/个人转账" : (counterparty || product || "微信交易");
    const { category, online } = autoCategory(`${safeMerchant} ${product} ${type}`, "微信");
    const normalizedDate = normalizeDate(dateText);
    results.push({
      id: makeId(["微信", normalizedDate, amount, safeMerchant, isRefund ? "退款" : "支出"]),
      date: normalizedDate,
      amount,
      direction: isRefund ? "refund" : "expense",
      merchant: safeMerchant.slice(0, 72),
      source: "微信",
      category: type === "转账" ? "食品水果与日用" : category,
      online,
      exceptional: isExceptional(`${safeMerchant} ${product}`),
      confidence: "high",
      paymentKind: isRefund ? "refund" : "purchase",
    });
  }
  return results;
}

async function parsePdf(file: File): Promise<Transaction[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.min.mjs", document.baseURI).toString();
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const results: Transaction[] = [];
  const pattern = /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(收入|支出)\s+(\d+(?:\.\d{1,2})?)/g;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    for (const match of text.matchAll(pattern)) {
      const amount = Number(match[3]);
      const normalizedDate = new Date(match[1].replace(" ", "T") + "+08:00").toISOString();
      results.push({
        id: makeId(["抖音", normalizedDate, amount, match[2]]),
        date: normalizedDate,
        amount,
        direction: match[2] === "收入" ? "refund" : "expense",
        merchant: match[2] === "收入" ? "抖音退款" : "抖音购物",
        source: "抖音",
        category: "自由消费",
        online: true,
        exceptional: false,
        confidence: "high",
        paymentKind: match[2] === "收入" ? "refund" : "purchase",
      });
    }
  }
  return results;
}

async function parseFile(file: File): Promise<{ transactions: Transaction[]; settings?: Settings; plannedExpenses?: PlannedExpense[] }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return { transactions: await parseCsv(file) };
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return { transactions: await parseXlsx(file) };
  if (name.endsWith(".pdf")) return { transactions: await parsePdf(file) };
  if (name.endsWith(".json")) {
    const data = JSON.parse(await file.text());
    return { transactions: data.transactions ?? [], settings: data.settings, plannedExpenses: data.plannedExpenses };
  }
  throw new Error(`暂不支持 ${file.name}`);
}

export default function FinanceApp() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [plannedExpenses, setPlannedExpenses] = useState<PlannedExpense[]>(DEFAULT_PLANNED);
  const [planDraft, setPlanDraft] = useState({ title: "", amount: 0, dueDate: "", frequency: "yearly" as PlannedExpense["frequency"], category: "保险医疗" as Category });
  const [quickDraft, setQuickDraft] = useState({ amount: "", merchant: "", category: "食品水果与日用" as Category });
  const [tab, setTab] = useState<"dashboard" | "transactions" | "settings">("dashboard");
  const [selectedMonth, setSelectedMonth] = useState(() => cycleStartKey(new Date()));
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const quickAmountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    const savedPlanned = localStorage.getItem(PLANNED_KEY);
    if (savedSettings) setSettings(normalizeSettings(JSON.parse(savedSettings)));
    else {
      setTab("settings");
      setFlash("首次使用：请先填写你的预算与储蓄计划");
    }
    if (savedPlanned) setPlannedExpenses(JSON.parse(savedPlanned));
    if (saved) {
      setTransactions(JSON.parse(saved));
      setReady(true);
      return;
    }
    setTransactions([]);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
  }, [transactions, ready]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(PLANNED_KEY, JSON.stringify(plannedExpenses));
  }, [plannedExpenses]);

  useEffect(() => {
    if (!ready) return;
    // Shortcut payloads use the URL fragment so financial SMS text stays on the
    // phone and is never sent to the static hosting server as part of the request.
    const fragment = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    const params = new URLSearchParams(fragment || window.location.search);
    const quickMode = params.get("quick") === "1";
    const sms = params.get("sms");
    const shortcutText = params.get("text");
    const shortcutAmount = parseAmount(params.get("amount") ?? "");
    const shortcutMerchant = (params.get("merchant") ?? "快捷指令记账").trim();
    const requestedCategory = params.get("category") as Category | null;
    const shortcutCategory = requestedCategory && [...QUICK_CATEGORIES, ...CATEGORY_LIMITS.map((item) => item.name)].includes(requestedCategory)
      ? requestedCategory
      : autoCategory(shortcutMerchant, "iPhone快捷指令").category;
    const parsed = sms || shortcutText ? parseSms(sms ?? shortcutText ?? "") : null;
    if (quickMode) {
      setTab("dashboard");
      window.setTimeout(() => {
        quickAmountRef.current?.focus();
        quickAmountRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 250);
    }
    if (parsed) {
      setTransactions((current) => dedupe([parsed, ...current]));
      setFlash(`已自动记录 ¥${parsed.amount.toFixed(2)}，分类为“${parsed.category}”`);
    } else if (Number.isFinite(shortcutAmount) && shortcutAmount > 0) {
      const date = new Date().toISOString();
      const item: Transaction = {
        id: makeId(["快捷指令", date, shortcutAmount, shortcutMerchant]),
        date,
        amount: shortcutAmount,
        direction: "expense",
        merchant: shortcutMerchant || "快捷指令记账",
        source: "iPhone快捷指令",
        category: shortcutCategory,
        online: false,
        provisional: false,
        exceptional: false,
        confidence: "high",
        paymentKind: "purchase",
      };
      setTransactions((current) => dedupe([item, ...current]));
      setFlash(`快捷指令已记录 ¥${item.amount.toFixed(2)} · ${item.category}`);
    } else if (sms || shortcutText) {
      setFlash("收到短信，但没有识别出消费金额");
    } else if (!quickMode) {
      return;
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, [ready]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(""), 4500);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    if (!ready) return;
    const today = new Date();
    if (today.getDate() !== CYCLE_DAY || dateKey(today) < TRACKING_START) return;
    const currentCycle = cycleStartKey(today);
    const reminderKey = `zhiyu-cycle-opened-${currentCycle}`;
    if (localStorage.getItem(reminderKey)) return;
    const currentStart = dayStart(currentCycle);
    const previousCycle = dateKey(new Date(currentStart.getFullYear(), currentStart.getMonth() - 1, CYCLE_DAY));
    const previousSpent = transactions
      .filter((item) => item.date.slice(0, 10) >= TRACKING_START && cycleStartKey(item.date) === previousCycle && item.category !== "预算外支出")
      .reduce((sum, item) => sum + budgetValue(item), 0);
    setSelectedMonth(currentCycle);
    setFlash(previousCycle >= TRACKING_START
      ? `上期总结：共支出 ¥${money(previousSpent)}；今天已开始新一期`
      : "知余第一期已开始：8月21日至9月20日");
    localStorage.setItem(reminderKey, "1");
  }, [ready, transactions]);

  const months = useMemo(() => {
    const currentCycle = cycleStartKey(new Date());
    const values = Array.from(new Set([
      currentCycle,
      ...transactions
        .filter((item) => item.date.slice(0, 10) >= TRACKING_START)
        .map((item) => cycleStartKey(item.date)),
    ]));
    return values.sort().reverse();
  }, [transactions]);

  useEffect(() => {
    if (months.length && !months.includes(selectedMonth)) setSelectedMonth(months[0]);
  }, [months, selectedMonth]);

  const monthItems = useMemo(
    () => transactions.filter((item) => item.date.slice(0, 10) >= TRACKING_START && cycleStartKey(item.date) === selectedMonth),
    [transactions, selectedMonth],
  );
  const budgetItems = useMemo(
    () => monthItems.filter((item) => item.category !== "预算外支出"),
    [monthItems],
  );

  const totalSpent = useMemo(
    () => budgetItems.reduce((sum, item) => sum + budgetValue(item), 0),
    [budgetItems],
  );
  const exceptionalSpent = useMemo(
    () => budgetItems.filter((item) => item.exceptional).reduce((sum, item) => sum + budgetValue(item), 0),
    [budgetItems],
  );
  const spent = totalSpent - exceptionalSpent;
  const spendingRate = settings.monthlyBudget > 0 ? Math.max(0, spent / settings.monthlyBudget) : 0;
  const remaining = settings.monthlyBudget - spent;
  const monthlyInvestmentAverage = settings.monthlyInvestment + (settings.weeklyInvestment * 52 / 12);
  const currentDayKey = dateKey(new Date());
  const todaySpent = transactions
    .filter((item) => item.date.slice(0, 10) === currentDayKey && item.category !== "预算外支出")
    .reduce((sum, item) => sum + budgetValue(item), 0);
  const cycleEnd = dayStart(cycleEndKey(selectedMonth));
  const remainingDays = selectedMonth === cycleStartKey(new Date())
    ? Math.max(1, Math.floor((cycleEnd.getTime() - dayStart(new Date()).getTime()) / 86400000) + 1)
    : Math.floor((cycleEnd.getTime() - dayStart(selectedMonth).getTime()) / 86400000) + 1;
  const dailyAvailable = Math.max(0, remaining) / remainingDays;
  const nextSummaryDate = nextCycleStartKey(selectedMonth);
  const unclassifiedCount = monthItems.filter((item) => item.provisional || item.confidence === "low" || item.category === "其他").length;
  const upcomingExpenses = useMemo(() => plannedExpenses
    .map((item) => ({ item, nextDate: nextOccurrence(item) }))
    .filter((entry): entry is { item: PlannedExpense; nextDate: string } => Boolean(entry.nextDate))
    .map((entry) => ({ ...entry, days: daysUntil(entry.nextDate) }))
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate)), [plannedExpenses]);
  const nextPlanned = upcomingExpenses[0];
  const dueWithin30Days = upcomingExpenses.filter((entry) => entry.days <= 30).reduce((sum, entry) => sum + entry.item.amount, 0);
  const dueWithin90Days = upcomingExpenses.filter((entry) => entry.days <= 90).reduce((sum, entry) => sum + entry.item.amount, 0);

  useEffect(() => {
    if (!ready || !nextPlanned || nextPlanned.days > 30 || !("Notification" in window) || Notification.permission !== "granted") return;
    const reminderKey = `zhiyu-reminded-${dateKey(new Date())}-${nextPlanned.item.id}-${nextPlanned.nextDate}`;
    if (localStorage.getItem(reminderKey)) return;
    new Notification(`固定支出将在${nextPlanned.days}天后扣款`, { body: `${nextPlanned.item.title} ¥${money(nextPlanned.item.amount)}，${nextPlanned.nextDate}` });
    localStorage.setItem(reminderKey, "1");
  }, [nextPlanned, ready]);

  const categorySpent = (name: Category) =>
    budgetItems
      .filter((item) => item.category === name)
      .reduce((sum, item) => sum + budgetValue(item), 0);
  const onlineSpent = budgetItems
    .filter((item) => item.online)
    .reduce((sum, item) => sum + budgetValue(item), 0);

  const budgetRows = CATEGORY_LIMITS.map((item) => ({
    ...item,
    limit: item.name === "食品水果与日用" ? settings.foodLimit : item.name === "自由消费" ? settings.freeLimit : item.limit,
    used: categorySpent(item.name),
  }));

  const alerts = useMemo(() => {
    const messages: Array<{ tone: string; title: string; body: string }> = [];
    if (settings.monthlyBudget > 0 && spendingRate >= 1) messages.push({ tone: "danger", title: "本月总预算已超出", body: `已超出 ¥${money(spent - settings.monthlyBudget)}，建议停止非必要消费。` });
    else if (spendingRate >= 0.8) messages.push({ tone: "warning", title: "本月预算接近上限", body: `已使用 ${Math.round(spendingRate * 100)}%，剩余 ¥${money(remaining)}。` });
    if (settings.onlineLimit > 0 && onlineSpent >= settings.onlineLimit) messages.push({ tone: "danger", title: "网购额度已用完", body: `本月非必要网购净支出 ¥${money(onlineSpent)}。` });
    else if (settings.onlineLimit > 0 && onlineSpent >= settings.onlineLimit * 0.8) messages.push({ tone: "warning", title: "网购额度接近上限", body: `再消费 ¥${money(settings.onlineLimit - onlineSpent)} 将达到计划上限。` });
    const food = categorySpent("食品水果与日用");
    if (settings.foodLimit > 0 && food >= settings.foodLimit * 0.8) messages.push({ tone: food > settings.foodLimit ? "danger" : "warning", title: "食品日用需要留意", body: `已使用 ¥${money(food)} / ¥${money(settings.foodLimit)}。` });
    if (!messages.length) messages.push({ tone: "good", title: "本月支出在计划内", body: "目前没有分类超过80%，继续保持当前节奏。" });
    return messages;
  }, [onlineSpent, remaining, settings, spent, spendingRate, budgetItems]);

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    setBusy(true);
    try {
      const imported: Transaction[] = [];
      let importedSettings: Settings | undefined;
      let importedPlanned: PlannedExpense[] | undefined;
      for (const file of files) {
        const result = await parseFile(file);
        imported.push(...result.transactions);
        if (result.settings) importedSettings = result.settings;
        if (result.plannedExpenses) importedPlanned = result.plannedExpenses;
      }
      const before = transactions.length;
      const merged = dedupe([...transactions, ...imported]);
      setTransactions(merged);
      if (importedSettings) setSettings(normalizeSettings(importedSettings));
      if (importedPlanned) setPlannedExpenses(importedPlanned);
      setFlash(`已导入 ${merged.length - before} 笔新记录，重复交易已自动跳过`);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "账单导入失败");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), settings, transactions, plannedExpenses }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `知余财务备份-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    setFlash("备份文件已生成，可存入 iCloud Drive");
  };

  const enableNotifications = async () => {
    if (!("Notification" in window)) {
      setFlash("当前浏览器不支持系统通知，可继续使用应用内提醒");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      new Notification("知余提醒已开启", { body: "预算达到80%或100%时会提醒你。" });
      setFlash("系统提醒已开启");
    } else setFlash("没有获得通知权限，仍会保留应用内提醒");
  };

  const resetData = () => {
    if (!window.confirm("确定清空本机的全部交易记录吗？请先导出备份。")) return;
    setTransactions([]);
    setFlash("本机交易记录已清空");
  };

  const addPlannedExpense = () => {
    if (!planDraft.title.trim() || planDraft.amount <= 0 || !planDraft.dueDate) {
      setFlash("请填写支出名称、金额和首次扣款日期");
      return;
    }
    const item: PlannedExpense = {
      id: `planned-${Date.now()}`,
      title: planDraft.title.trim(),
      amount: planDraft.amount,
      dueDate: planDraft.dueDate,
      frequency: planDraft.frequency,
      category: planDraft.category,
      active: true,
      paidOccurrences: [],
    };
    setPlannedExpenses((current) => [...current, item]);
    setPlanDraft({ title: "", amount: 0, dueDate: "", frequency: "yearly", category: "保险医疗" });
    setFlash(`已安排“${item.title}”，到期前会在总览提醒`);
  };

  const markPlannedPaid = (item: PlannedExpense, occurrence: string) => {
    setPlannedExpenses((current) => current.map((entry) => entry.id !== item.id ? entry : {
      ...entry,
      active: entry.frequency === "once" ? false : entry.active,
      paidOccurrences: Array.from(new Set([...entry.paidOccurrences, occurrence])),
    }));
    setFlash(`已将“${item.title}”标记为本期已支付`);
  };

  const addQuickExpense = () => {
    const amount = parseAmount(quickDraft.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFlash("请先填写正确的支出金额");
      return;
    }
    const date = new Date().toISOString();
    const merchant = quickDraft.merchant.trim() || "快速记账";
    const item: Transaction = {
      id: makeId(["快速记账", date, amount, merchant]),
      date,
      amount,
      direction: "expense",
      merchant,
      source: "快速记账",
      category: quickDraft.category,
      online: false,
      provisional: false,
      exceptional: false,
      confidence: "high",
      paymentKind: "purchase",
    };
    setTransactions((current) => dedupe([item, ...current]));
    setSelectedMonth(cycleStartKey(date));
    setQuickDraft((current) => ({ ...current, amount: "", merchant: "" }));
    setFlash(`已记 ¥${amount.toFixed(2)} · ${item.category}`);
  };

  return (
    <main className="app-shell">
      {flash && <div className="toast" role="status">{flash}</div>}
      <input ref={fileInput} className="hidden-input" type="file" multiple accept=".csv,.xlsx,.xls,.pdf,.json" onChange={handleFiles} />

      <header className="app-header">
        <button className="brand" onClick={() => setTab("dashboard")} aria-label="返回财务总览">
          <span className="brand-mark">余</span><span><strong>知余</strong><small>日常支出与现金</small></span>
        </button>
        <nav className="tabs" aria-label="主导航">
          <button className={tab === "dashboard" ? "active" : ""} onClick={() => setTab("dashboard")}>记账</button>
          <button className={tab === "transactions" ? "active" : ""} onClick={() => setTab("transactions")}>流水</button>
          <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>计划</button>
        </nav>
        <div className="header-actions">
          <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} aria-label="选择月份">
            {(months.length ? months : [selectedMonth]).map((month) => <option key={month} value={month}>{cycleLabel(month)}</option>)}
          </select>
          <button className="import-button" onClick={() => fileInput.current?.click()} disabled={busy}>{busy ? "处理中…" : "＋ 导入账单"}</button>
        </div>
      </header>

      {tab === "dashboard" && (
        <section className="mobile-home">
          <header className="compact-masthead">
            <div className="masthead-cat" aria-label="招手的招财猫">
              <div className="cat-sprite compact-cat" aria-hidden="true" />
              {Array.from({ length: 8 }).map((_, index) => <span key={index} className={`scattered-coin scattered-coin-${index + 1}`} aria-hidden="true" />)}
            </div>
            <div className="masthead-copy"><small>本期 {cycleLabel(selectedMonth)}</small><h1>今天，钱花在哪里？</h1><p>{nextSummaryDate.slice(5).replace("-", "月")}日总结并开启新一期</p></div>
            <select className="home-month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} aria-label="选择月份">
              {(months.length ? months : [selectedMonth]).map((month) => <option key={month} value={month}>{cycleLabel(month)}</option>)}
            </select>
          </header>

          <section className="quick-entry" aria-label="快速记一笔支出">
            <div className="quick-entry-top"><div><small>快速记一笔</small><div className="amount-input"><span>¥</span><input ref={quickAmountRef} inputMode="decimal" type="number" min="0" step="0.01" value={quickDraft.amount} placeholder="0.00" onChange={(event) => setQuickDraft({ ...quickDraft, amount: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") addQuickExpense(); }} /></div></div><button onClick={addQuickExpense}>记下</button></div>
            <input className="merchant-input" value={quickDraft.merchant} placeholder="花在什么地方？可不填" onChange={(event) => setQuickDraft({ ...quickDraft, merchant: event.target.value })} />
            <div className="category-chips" aria-label="选择分类">{QUICK_CATEGORIES.map((category) => <button key={category} className={quickDraft.category === category ? "active" : ""} onClick={() => setQuickDraft({ ...quickDraft, category })}>{category === "食品水果与日用" ? "食品日用" : category === "车辆交通" ? "车辆" : category}</button>)}</div>
            <p className="shortcut-hint">支持 iPhone 快捷指令自动传入短信或金额 · 错账可在“流水”修改</p>
          </section>

          <section className="money-at-glance" aria-label="本月可用金额">
            <article className="glance-primary"><small>本月还能花</small><strong className={remaining < 0 ? "negative" : ""}>¥{money(Math.abs(remaining))}</strong><span>{spendingRate >= 1 ? "已超预算" : `已用 ${Math.round(spendingRate * 100)}%`}</span></article>
            <article><small>今天已花</small><strong>¥{money(todaySpent)}</strong><span>不含资金划转</span></article>
            <article><small>今日建议上限</small><strong>¥{money(dailyAvailable)}</strong><span>按剩余 {remainingDays} 天</span></article>
            <article><small>30天需预留</small><strong>¥{money(dueWithin30Days)}</strong><span>{nextPlanned ? nextPlanned.item.title : "暂无固定支出"}</span></article>
          </section>

          <section className="control-grid">
            <article className="compact-control-card budget-control">
              <div className="compact-heading"><div><small>支出边界</small><h2>{alerts[0].title}</h2></div><span className={`risk-dot ${alerts[0].tone}`}>{unclassifiedCount ? `${unclassifiedCount}笔待确认` : "分类已清"}</span></div>
              <div className="dense-budget-list">{[
                { name: "食品日用", used: categorySpent("食品水果与日用"), limit: settings.foodLimit, tone: "mint" },
                { name: "自由消费", used: categorySpent("自由消费"), limit: settings.freeLimit, tone: "amber" },
                { name: "非必要网购", used: onlineSpent, limit: settings.onlineLimit, tone: "rose" },
              ].map((item) => <BudgetBar key={item.name} {...item} />)}</div>
            </article>

            <article className="compact-control-card cash-control">
              <div className="compact-heading"><div><small>现金安排</small><h2>先预留，再消费</h2></div><button className="text-button" onClick={() => setTab("settings")}>调整</button></div>
              <div className="cash-lines"><div><span>生活资金池</span><strong>¥{money(settings.reserveFund)}</strong></div><div><span>月均定投</span><strong>¥{money(monthlyInvestmentAverage)}</strong></div><div><span>本月一次性支出</span><strong>¥{money(exceptionalSpent)}</strong></div></div>
            </article>
          </section>

          <section className={`next-payment-strip ${nextPlanned && nextPlanned.days <= 30 ? "urgent" : ""}`} onClick={() => setTab("settings")} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setTab("settings"); }}>
            <div><small>下一笔固定支出</small><strong>{nextPlanned ? `${nextPlanned.days}天后 · ${nextPlanned.item.title}` : "暂无待支付项目"}</strong></div><b>{nextPlanned ? `¥${money(nextPlanned.item.amount)}` : "添加 ›"}</b>
          </section>

          <section className="compact-recent">
            <div className="compact-heading"><div><small>刚刚记过</small><h2>最近两笔</h2></div><button className="text-button" onClick={() => setTab("transactions")}>全部流水</button></div>
            <TransactionList items={monthItems.slice(0, 2)} />
          </section>
        </section>
      )}

      {tab === "transactions" && (
        <section className="workspace-panel">
          <div className="workspace-heading"><div><p className="eyebrow">{cycleLabel(selectedMonth)} 周期总结</p><h1>本期支出 ¥{money(spent)}</h1><p>共 {monthItems.length} 笔 · 日均 ¥{money(spent / Math.max(1, Math.floor((Math.min(dayStart(new Date()).getTime(), cycleEnd.getTime()) - dayStart(selectedMonth).getTime()) / 86400000) + 1))} · 一次性支出 ¥{money(exceptionalSpent)} · {nextSummaryDate.slice(5).replace("-", "月")}日开始新一期</p></div><button className="secondary-button" onClick={exportBackup}>导出备份</button></div>
          <div className="transaction-table">
            {monthItems.length ? monthItems.map((item) => <TransactionRow key={item.id} item={item} onCategory={(category) => setTransactions((current) => current.map((entry) => entry.id === item.id ? { ...entry, category, provisional: false, confidence: "high", budgetExcluded: entry.paymentKind === "transfer" && category !== "其他" ? false : entry.budgetExcluded, paymentKind: entry.paymentKind === "transfer" && category !== "其他" ? "purchase" : entry.paymentKind } : entry))} />) : <div className="empty-state large-empty">还没有这个月的交易记录。银行短信到达后会自动出现。</div>}
          </div>
        </section>
      )}

      {tab === "settings" && (
        <section className="settings-grid">
          <article className="workspace-panel full-width planned-manager">
            <div className="panel-heading"><div><p className="eyebrow">未来现金安排</p><h2>固定支出与到期提醒</h2><p className="settings-intro">预计支出不会算作已经花掉的钱；到期前30天会在总览突出提醒。</p></div><span className="soft-badge">未来90天 ¥{money(dueWithin90Days)}</span></div>
            <div className="planned-workspace">
              <div className="planned-list">{upcomingExpenses.length ? upcomingExpenses.map(({ item, nextDate, days }) => <div className="planned-row" key={item.id}><div className="planned-date"><strong>{nextDate.slice(5).replace("-", "/")}</strong><small>{days === 0 ? "今天" : `${days}天后`}</small></div><div className="planned-main"><strong>{item.title}</strong><small>{item.category} · {item.frequency === "yearly" ? "每年重复" : item.frequency === "monthly" ? "每月重复" : "一次性"}</small></div><b>¥{money(item.amount)}</b><div className="planned-actions"><button onClick={() => markPlannedPaid(item, nextDate)}>本期已付</button><button className="delete-plan" onClick={() => setPlannedExpenses((current) => current.filter((entry) => entry.id !== item.id))}>删除</button></div></div>) : <div className="empty-state large-empty">还没有未来固定支出。</div>}</div>
              <div className="plan-form"><h3>添加一笔未来支出</h3><label><span>名称</span><input value={planDraft.title} placeholder="例如：年度保险" onChange={(event) => setPlanDraft({ ...planDraft, title: event.target.value })} /></label><div className="plan-form-pair"><label><span>金额</span><input type="number" min="0" value={planDraft.amount || ""} placeholder="0" onChange={(event) => setPlanDraft({ ...planDraft, amount: Number(event.target.value) })} /></label><label><span>首次扣款日期</span><input type="date" value={planDraft.dueDate} onChange={(event) => setPlanDraft({ ...planDraft, dueDate: event.target.value })} /></label></div><div className="plan-form-pair"><label><span>重复方式</span><select value={planDraft.frequency} onChange={(event) => setPlanDraft({ ...planDraft, frequency: event.target.value as PlannedExpense["frequency"] })}><option value="once">仅一次</option><option value="monthly">每月</option><option value="yearly">每年</option></select></label><label><span>分类</span><select value={planDraft.category} onChange={(event) => setPlanDraft({ ...planDraft, category: event.target.value as Category })}>{CATEGORY_LIMITS.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label></div><button className="import-button" onClick={addPlannedExpense}>添加并开启提醒</button></div>
            </div>
          </article>
          <article className="workspace-panel">
            <p className="eyebrow">支出与储蓄计划</p><h1>你的财务边界</h1><p className="settings-intro">先设置由你管理的支出范围、分类额度与储蓄目标；所有设置只保存在当前设备。</p>
            <div className="setting-list">
              <SettingField label="本人管理月支出上限" value={settings.monthlyBudget} onChange={(value) => setSettings({ ...settings, monthlyBudget: value })} />
              <SettingField label="食品水果与日用" value={settings.foodLimit} onChange={(value) => setSettings({ ...settings, foodLimit: value })} />
              <SettingField label="自由消费" value={settings.freeLimit} onChange={(value) => setSettings({ ...settings, freeLimit: value })} />
              <SettingField label="非必要网购子额度" value={settings.onlineLimit} onChange={(value) => setSettings({ ...settings, onlineLimit: value })} />
              <SettingField label="每月固定定投" value={settings.monthlyInvestment} onChange={(value) => setSettings({ ...settings, monthlyInvestment: value })} />
              <SettingField label="每周定投" value={settings.weeklyInvestment} onChange={(value) => setSettings({ ...settings, weeklyInvestment: value })} />
              <SettingField label="最低生活资金池" value={settings.reserveFund} onChange={(value) => setSettings({ ...settings, reserveFund: value })} />
            </div>
          </article>

          <aside className="settings-stack">
            <article className="panel setup-card"><p className="eyebrow">快捷记账</p><h2>双击背面 → 金额输入</h2><ol><li>建立“打开URL”快捷指令，网址末尾使用 <code>/?quick=1</code>。</li><li>在“设置 → 辅助功能 → 触控 → 轻点背面”绑定轻点两下。</li><li>双击后直接聚焦金额框，选分类即可记下。</li><li>银行短信自动化请使用 <code>/#sms=编码后的短信内容</code>，内容只在手机本地交给知余识别。</li></ol><p className="fine-print">记账周期固定为每月21日至次月20日；21日生成上期总结并自动进入新一期。资金划转和收入默认不占消费预算。</p></article>
            <article className="panel data-card"><p className="eyebrow">本机独立使用</p><h2>数据只保存在这部手机</h2><p className="fine-print">不连接电脑，也不会实时同步。建议每月总结后导出一次备份并存入 iCloud Drive；清除 Safari 网站数据或更换手机前务必先备份。</p></article>
            <article className="panel data-card"><p className="eyebrow">数据与提醒</p><div className="button-stack"><button className="secondary-button" onClick={enableNotifications}>开启系统提醒</button><button className="secondary-button" onClick={exportBackup}>备份到 iCloud Drive</button><button className="danger-button" onClick={resetData}>清空本机数据</button></div></article>
          </aside>

          <article className="workspace-panel full-width">
            <div className="panel-heading"><div><p className="eyebrow">完整月度预算</p><h2>¥{money(settings.monthlyBudget)} 如何分配</h2></div><span className="soft-badge">定投不计入消费</span></div>
            <div className="allocation-grid">{budgetRows.map((item) => <BudgetBar key={item.name} name={item.name} used={item.used} limit={item.limit} tone={item.used > item.limit ? "rose" : "mint"} />)}</div>
          </article>
        </section>
      )}
      <nav className="mobile-bottom-nav" aria-label="手机主导航">
        <button className={tab === "dashboard" ? "active" : ""} onClick={() => setTab("dashboard")}><span>＋</span>记账</button>
        <button className={tab === "transactions" ? "active" : ""} onClick={() => setTab("transactions")}><span>≡</span>流水</button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}><span>◎</span>预算与计划</button>
      </nav>
    </main>
  );
}

function BudgetBar({ name, used, limit, tone }: { name: string; used: number; limit: number; tone: string }) {
  const percent = Math.max(0, Math.min(100, (used / Math.max(1, limit)) * 100));
  return <div className="budget-row"><div className="budget-copy"><span>{name}</span><span className={used > limit ? "over" : ""}>¥{money(used)} / ¥{money(limit)}</span></div><div className={`progress-track ${tone}`}><span style={{ width: `${percent}%` }} /></div></div>;
}

function TransactionList({ items }: { items: Transaction[] }) {
  if (!items.length) return <p className="empty-state">暂无流水</p>;
  return <div className="mini-list">{items.map((item) => <div className="mini-row" key={item.id}><span className={`source-dot ${item.source}`}>{item.source.slice(0, 1)}</span><div><strong>{item.merchant}</strong><small>{localDate(item.date)} · {item.category}{item.confidence === "low" ? " · 低可信度" : ""}</small></div><b className={item.budgetExcluded ? "transfer" : item.direction === "refund" ? "refund" : ""}>{item.budgetExcluded ? "↔" : item.direction === "refund" ? "+" : "-"}¥{item.amount.toFixed(2)}</b></div>)}</div>;
}

function TransactionRow({ item, onCategory }: { item: Transaction; onCategory: (category: Category) => void }) {
  const confidenceText = item.confidence === "low" ? " · 分类可信度低" : item.confidence === "medium" ? " · 分类可信度中" : "";
  const kindText = item.paymentKind === "transfer" ? " · 资金划转/不计预算" : item.paymentKind === "income" ? " · 收入/不计预算" : item.paymentKind === "refund" ? " · 退款" : "";
  return <div className="transaction-row"><div className={`source-dot ${item.source}`}>{item.source.slice(0, 1)}</div><div className="transaction-main"><strong>{item.merchant}</strong><span>{localDate(item.date)} · {item.source}{confidenceText}{kindText}{item.exceptional ? " · 一次性" : ""}{item.category === "预算外支出" ? " · 不计预算" : ""}</span></div><select value={item.category} onChange={(event) => onCategory(event.target.value as Category)} aria-label={`修改${item.merchant}的分类`}>{[...CATEGORY_LIMITS.map((entry) => entry.name), "预算外支出", "其他"].map((category) => <option key={category}>{category}</option>)}</select><b className={item.budgetExcluded ? "transfer" : item.direction === "refund" ? "refund" : ""}>{item.budgetExcluded ? "↔" : item.direction === "refund" ? "+" : "-"}¥{item.amount.toFixed(2)}</b></div>;
}

function SettingField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="setting-field"><span>{label}</span><div><small>¥</small><input type="number" min="0" step="100" value={value} onChange={(event) => onChange(Number(event.target.value) || 0)} /></div></label>;
}
