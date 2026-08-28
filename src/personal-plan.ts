import type { Category, PlannedExpense, Settings } from "./FinanceApp";

export type PersonalSetup = { id: string; settings: Settings; plannedExpenses: PlannedExpense[] };
const categories: Category[] = ["老人住房", "孩子", "保险医疗", "老人赡养", "车辆交通", "食品水果与日用", "水电物业通讯", "物业费", "自由消费", "定投储蓄", "其他", "预算外支出"];
const frequencies = ["once", "weekly", "biweekly", "monthly", "quarterly", "yearly"] as const;
const fail = (): never => { throw new Error("个人计划格式无效，请使用完整的专用链接或计划文件。"); };
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const amount = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e8 && Math.abs(v * 100 - Math.round(v * 100)) < 0.0001 ? v : fail();
const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : fail();
const category = (v: unknown): Category => typeof v === "string" && categories.includes(v as Category) ? v as Category : fail();
const categoryList = (v: unknown): Category[] => Array.isArray(v) && v.length <= categories.length ? Array.from(new Set(v.map(category))) : fail();
const validDate = (v: unknown): string => {
  const value = text(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return fail();
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= "2000-01-01" && value <= "2100-12-31" ? value : fail();
};

// Compact, validated transport. Values arrive from the user's private link or
// local file; this module contains no personal defaults and makes no requests.
export function parsePersonalSetup(raw: unknown): PersonalSetup {
  if (!isObject(raw) || raw.v !== 1 || !Array.isArray(raw.s) || raw.s.length !== 5 || !Array.isArray(raw.p) || raw.p.length > 50 || !Array.isArray(raw.c) || raw.c.length > categories.length) return fail();
  const id = text(raw.k, 80);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return fail();
  const [monthlyBudget, reserveFund, foodLimit, freeLimit, onlineLimit] = raw.s.map(amount);
  const categoryLimits: Partial<Record<Category, number>> = {};
  for (const row of raw.c) {
    if (!Array.isArray(row) || row.length !== 2) return fail();
    categoryLimits[category(row[0])] = amount(row[1]);
  }
  const budgetNotes = raw.n === undefined ? [] : Array.isArray(raw.n) && raw.n.length <= 12 ? raw.n.map(v => text(v, 300)) : fail();
  const seen = new Set<string>();
  const plannedExpenses: PlannedExpense[] = raw.p.map(row => {
    if (!Array.isArray(row) || row.length !== 6) return fail();
    const planId = text(row[0], 80);
    if (!/^[A-Za-z0-9_-]+$/.test(planId) || seen.has(planId)) return fail();
    seen.add(planId);
    const title = text(row[1], 80);
    const cost = amount(row[2]);
    const dueDate = validDate(row[3]);
    if (!cost || !frequencies.includes(row[4])) return fail();
    const cat = category(row[5]);
    return { id: planId, title, amount: cost, dueDate, frequency: row[4], category: cat, kind: cat === "定投储蓄" ? "investment" : "expense", active: true, paidOccurrences: [] };
  });
  return { id, settings: { monthlyBudget, reserveFund, foodLimit, freeLimit, onlineLimit, monthlyInvestment: 0, weeklyInvestment: 0, categoryLimits, excludedCategories: categoryList(raw.x ?? []), billCategories: categoryList(raw.b ?? []), budgetNotes }, plannedExpenses };
}

export function decodePersonalSetup(encoded: string): PersonalSetup {
  if (!encoded || encoded.length > 20000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return fail();
  try {
    const bytes = Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    return parsePersonalSetup(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch { return fail(); }
}

export function mergeSetupPlans(existing: PlannedExpense[], incoming: PlannedExpense[]): PlannedExpense[] {
  const result = existing.map(plan => ({ ...plan, paidOccurrences: [...plan.paidOccurrences] }));
  for (const plan of incoming) {
    const index = result.findIndex(old => old.id === plan.id || (old.title === plan.title && old.amount === plan.amount && old.category === plan.category && old.frequency === plan.frequency));
    if (index < 0) result.push(plan);
    else result[index] = { ...plan, id: result[index].id, paidOccurrences: result[index].paidOccurrences, active: result[index].active };
  }
  return result;
}
