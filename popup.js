const WEEK = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const KEY = "work_attendance_itab_data";
const THEME_TEXT = { mist: "晨雾", ocean: "海盐", paper: "纸感" };
const THEMES = ["mist", "ocean", "paper"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const state = {
  currentYear: 0,
  currentMonth: 0,
  selectedDate: "",
  data: { months: {}, settings: { theme: "mist", viewMode: "month", minimalMode: false } },
  firstPaint: true,
  metricCache: { worked: 0, total: 0, prefilled: 0 },
  viewMode: "month",
  theme: "mist",
  minimalMode: false,
  minimalPrevViewMode: "month"
};

const $ = (id) => document.getElementById(id);
const ui = {
  monthText: $("monthText"),
  todayText: $("todayText"),
  topTodayText: $("topTodayText"),
  workedDays: $("workedDays"),
  totalIncome: $("totalIncome"),
  prefilledIncome: $("prefilledIncome"),
  weekHead: $("weekHead"),
  calendar: $("calendar"),
  dailyWage: $("dailyWage"),
  selectedDateLabel: $("selectedDateLabel"),
  selectedIncome: $("selectedIncome"),
  monthProgressText: $("monthProgressText"),
  monthProgressBar: $("monthProgressBar"),
  statusChip: $("statusChip"),
  streakChip: $("streakChip"),
  monthViewBtn: $("monthViewBtn"),
  weekViewBtn: $("weekViewBtn"),
  themeBtn: $("themeBtn"),
  minimalBtn: $("minimalBtn"),
  weekNav: $("weekNav"),
  prevWeekBtn: $("prevWeekBtn"),
  nextWeekBtn: $("nextWeekBtn"),
  markTodayBtn: $("markTodayBtn"),
  toast: $("toast")
};

function storageGet(key) {
  return new Promise((resolve) => chrome.storage.local.get([key], (r) => resolve(r[key])));
}

function storageSet(value) {
  return new Promise((resolve) => chrome.storage.local.set({ [KEY]: value }, resolve));
}

function monthKey(y = state.currentYear, m = state.currentMonth) {
  return `${y}-${String(m).padStart(2, "0")}`;
}

function dateStr(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseDate(text) {
  const [y, m, d] = text.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isValidDateStr(text) {
  if (typeof text !== "string" || !DATE_RE.test(text)) return false;
  const d = parseDate(text);
  return formatDate(d) === text;
}

function monthKeyFromDateStr(text) {
  if (!isValidDateStr(text)) return "";
  return text.slice(0, 7);
}

function formatDate(d) {
  return dateStr(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function sameMonth(d, y, m) {
  return d.getFullYear() === y && d.getMonth() + 1 === m;
}

function getTodayInfo() {
  const t = new Date();
  return {
    year: t.getFullYear(),
    month: t.getMonth() + 1,
    date: dateStr(t.getFullYear(), t.getMonth() + 1, t.getDate())
  };
}

function todayLabel() {
  const t = new Date();
  return `今天：${dateStr(t.getFullYear(), t.getMonth() + 1, t.getDate())}`;
}

function ensureMonth(key = monthKey()) {
  if (!state.data.months[key]) {
    state.data.months[key] = { dailyWage: 0, workedDates: [], dailyIncomeMap: {} };
  }
  const m = state.data.months[key];

  const keyPrefix = `${key}-`;
  const workedList = Array.isArray(m.workedDates) ? m.workedDates : [];
  m.workedDates = [...new Set(workedList.filter((d) => isValidDateStr(d) && d.startsWith(keyPrefix)))].sort();

  const incomeMap = m.dailyIncomeMap && typeof m.dailyIncomeMap === "object" ? m.dailyIncomeMap : {};
  m.dailyIncomeMap = Object.fromEntries(
    Object.entries(incomeMap)
      .filter(([d]) => isValidDateStr(d) && d.startsWith(keyPrefix))
      .map(([d, v]) => [d, numOrNull(v) ?? 0])
  );

  m.dailyWage = Number(m.dailyWage) >= 0 ? Number(m.dailyWage) : 0;
  return m;
}

function monthDataByDateStr(dstr) {
  const key = monthKeyFromDateStr(dstr);
  return key ? ensureMonth(key) : ensureMonth();
}

function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function calcIncome(m) {
  let total = 0;
  let prefilled = 0;
  m.workedDates.forEach((d) => {
    if (Object.prototype.hasOwnProperty.call(m.dailyIncomeMap, d)) {
      const n = Number(m.dailyIncomeMap[d]) || 0;
      total += n;
      prefilled += n;
    } else {
      total += Number(m.dailyWage) || 0;
    }
  });
  return { total, prefilled };
}

function calcStreak(workedDates) {
  if (!workedDates.length) return 0;
  const arr = [...workedDates].sort();
  let s = 1;
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const diff = Math.round((parseDate(arr[i]) - parseDate(arr[i - 1])) / 86400000);
    if (diff === 1) s += 1;
    else break;
  }
  return s;
}

function isStreakBroken(workedDates) {
  if (!workedDates.length) return false;
  const last = parseDate([...workedDates].sort().slice(-1)[0]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  last.setHours(0, 0, 0, 0);
  return Math.floor((today - last) / 86400000) > 1;
}
function animateMetric(el, target, type, key) {
  const start = state.metricCache[key] || 0;
  if (start === target) {
    el.textContent = type === "days" ? `${Math.round(target)}天` : `¥${Math.round(target)}`;
    return;
  }
  const t0 = performance.now();
  const duration = 280;
  function step(now) {
    const p = Math.min((now - t0) / duration, 1);
    const val = start + (target - start) * (1 - Math.pow(1 - p, 3));
    el.textContent = type === "days" ? `${Math.round(val)}天` : `¥${Math.round(val)}`;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
  state.metricCache[key] = target;
}

function renderWeekHead() {
  ui.weekHead.innerHTML = "";
  WEEK.forEach((w) => {
    const div = document.createElement("div");
    div.textContent = w;
    ui.weekHead.appendChild(div);
  });
}

function createDayCell(i, dstr) {
  const el = document.createElement("div");
  el.className = "day";
  if (state.firstPaint) el.style.setProperty("--delay", `${Math.min(i * 16, 230)}ms`);

  const d = parseDate(dstr);
  const dayData = monthDataByDateStr(dstr);
  const workedSet = new Set(dayData.workedDates);
  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
  const isWorked = workedSet.has(dstr);
  const isSelected = state.selectedDate === dstr;

  if (isWeekend) el.classList.add("weekend");
  if (isWorked) el.classList.add("worked");
  else el.classList.add("unworked");
  if (isSelected) el.classList.add("selected");

  const n = document.createElement("div");
  n.className = "num";
  n.textContent = String(d.getDate());

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = Object.prototype.hasOwnProperty.call(dayData.dailyIncomeMap, dstr)
    ? `¥${Number(dayData.dailyIncomeMap[dstr]).toFixed(0)}`
    : (isWorked ? "已打卡" : "未打卡");

  el.appendChild(n);
  el.appendChild(meta);
  el.addEventListener("click", () => {
    if (state.selectedDate !== dstr) {
      state.selectedDate = dstr;
      renderAll();
    } else {
      toggleWorked(dstr);
    }
  });
  return el;
}

function renderMonthCalendar() {
  ui.calendar.innerHTML = "";
  const y = state.currentYear;
  const m = state.currentMonth;
  const first = new Date(y, m - 1, 1);
  const total = new Date(y, m, 0).getDate();
  const firstWeekday = (first.getDay() + 6) % 7;
  for (let i = 0; i < 42; i += 1) {
    if (i < firstWeekday || i >= firstWeekday + total) {
      const blank = document.createElement("div");
      blank.className = "day blank";
      ui.calendar.appendChild(blank);
      continue;
    }
    const day = i - firstWeekday + 1;
    ui.calendar.appendChild(createDayCell(i, dateStr(y, m, day)));
  }
}

function renderWeekCalendar() {
  ui.calendar.innerHTML = "";
  let base = state.selectedDate ? parseDate(state.selectedDate) : new Date(state.currentYear, state.currentMonth - 1, 1);
  const monday = addDays(base, -((base.getDay() + 6) % 7));

  for (let i = 0; i < 7; i += 1) {
    const d = addDays(monday, i);
    const dstr = formatDate(d);
    const cell = createDayCell(i, dstr);
    if (!sameMonth(d, state.currentYear, state.currentMonth)) {
      cell.classList.add("blank");
      cell.style.visibility = "visible";
      cell.style.opacity = "0.45";
    }
    ui.calendar.appendChild(cell);
  }
}

function renderCalendar() {
  if (state.viewMode === "week") renderWeekCalendar();
  else renderMonthCalendar();
}

function applyTheme(theme) {
  state.theme = THEMES.includes(theme) ? theme : "mist";
  document.body.classList.remove("theme-mist", "theme-ocean", "theme-paper");
  document.body.classList.add(`theme-${state.theme}`);
}

function applyMinimalMode(on) {
  const next = !!on;
  if (next && !state.minimalMode) {
    state.minimalPrevViewMode = state.viewMode;
    state.viewMode = "week";
  } else if (!next && state.minimalMode) {
    state.viewMode = state.minimalPrevViewMode || "month";
  }
  state.minimalMode = next;
  document.body.classList.toggle("minimal-mode", state.minimalMode);
  ui.minimalBtn.textContent = `极速：${state.minimalMode ? "开" : "关"}`;
  ui.minimalBtn.classList.toggle("active", state.minimalMode);
}

function renderStatsAndForm() {
  const m = ensureMonth();
  const money = calcIncome(m);
  const streak = calcStreak(m.workedDates);
  const broken = isStreakBroken(m.workedDates);
  const totalDays = new Date(state.currentYear, state.currentMonth, 0).getDate();
  const progress = totalDays ? Math.round((m.workedDates.length / totalDays) * 100) : 0;

  animateMetric(ui.workedDays, m.workedDates.length, "days", "worked");
  animateMetric(ui.totalIncome, money.total, "money", "total");
  animateMetric(ui.prefilledIncome, money.prefilled, "money", "prefilled");

  ui.streakChip.textContent = broken ? `断签前连续${streak}天` : `连续${streak}天`;
  ui.streakChip.classList.toggle("warn", broken);
  ui.monthProgressText.textContent = `本月进度 ${progress}%`;
  ui.monthProgressBar.style.width = `${Math.min(Math.max(progress, 0), 100)}%`;

  if (progress >= 80) ui.statusChip.textContent = "状态很好";
  else if (progress >= 45) ui.statusChip.textContent = "进行中";
  else if (m.workedDates.length > 0) ui.statusChip.textContent = "稳步推进";
  else ui.statusChip.textContent = "待开始";

  ui.dailyWage.value = m.dailyWage ? String(m.dailyWage) : "";
  if (state.selectedDate && state.selectedDate.startsWith(monthKey() + "-")) {
    const v = m.dailyIncomeMap[state.selectedDate];
    ui.selectedDateLabel.textContent = `选中日期：${state.selectedDate}`;
    ui.selectedIncome.value = v == null ? "" : String(v);
    ui.selectedIncome.disabled = false;
  } else {
    ui.selectedDateLabel.textContent = "选中日期：未选择";
    ui.selectedIncome.value = "";
    ui.selectedIncome.disabled = true;
  }

  ui.monthViewBtn.classList.toggle("active", state.viewMode === "month");
  ui.weekViewBtn.classList.toggle("active", state.viewMode === "week");
  ui.themeBtn.textContent = `主题：${THEME_TEXT[state.theme] || "晨雾"}`;
  ui.weekNav.classList.toggle("hidden", state.viewMode !== "week");
  ui.minimalBtn.textContent = `极速：${state.minimalMode ? "开" : "关"}`;
  ui.minimalBtn.classList.toggle("active", state.minimalMode);

  const today = getTodayInfo();
  const todayMonthData = ensureMonth(monthKey(today.year, today.month));
  const isTodayWorked = todayMonthData.workedDates.includes(today.date);
  const markBtn = $("markTodayBtn");
  if (markBtn) {
    markBtn.textContent = isTodayWorked ? "取消今日" : "今天打卡";
    markBtn.classList.toggle("ghost", isTodayWorked);
    markBtn.classList.toggle("primary", !isTodayWorked);
  }
}

function renderAll() {
  ui.monthText.textContent = monthKey();
  if (ui.todayText) ui.todayText.textContent = todayLabel();
  if (ui.topTodayText) ui.topTodayText.textContent = todayLabel();
  renderCalendar();
  renderStatsAndForm();
  state.firstPaint = false;
}

function saveAndRender() {
  state.data.settings = state.data.settings || {};
  state.data.settings.theme = state.theme;
  state.data.settings.viewMode = state.viewMode;
  state.data.settings.minimalMode = state.minimalMode;
  return storageSet(state.data).then(renderAll);
}

function toggleWorked(dstr) {
  const m = monthDataByDateStr(dstr);
  const set = new Set(m.workedDates);
  if (set.has(dstr)) set.delete(dstr);
  else set.add(dstr);
  m.workedDates = [...set].sort();
  saveAndRender();
}

function cycleTheme() {
  const idx = THEMES.indexOf(state.theme);
  applyTheme(THEMES[(idx + 1) % THEMES.length]);
  saveAndRender();
}

function shiftWeek(delta) {
  let base = state.selectedDate ? parseDate(state.selectedDate) : new Date(state.currentYear, state.currentMonth - 1, 1);
  base = addDays(base, delta * 7);
  state.currentYear = base.getFullYear();
  state.currentMonth = base.getMonth() + 1;
  state.selectedDate = formatDate(base);
  state.firstPaint = true;
  ensureMonth();
  saveAndRender();
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendance-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function flashTodayButton(isNew) {
  if (!ui.markTodayBtn) return;
  const oldText = ui.markTodayBtn.textContent;
  ui.markTodayBtn.classList.add("done");
  ui.markTodayBtn.textContent = isNew ? "已打卡" : "已取消";
  setTimeout(() => {
    ui.markTodayBtn.classList.remove("done");
    ui.markTodayBtn.textContent = oldText;
  }, 1200);
}

function showToast(text, kind = "success") {
  if (!ui.toast) return;
  ui.toast.textContent = text;
  ui.toast.className = `toast ${kind}`;
  requestAnimationFrame(() => ui.toast.classList.add("show"));
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    ui.toast.classList.remove("show");
  }, 800);
}

function pulseTodayButton() {
  if (!ui.markTodayBtn) return;
  ui.markTodayBtn.classList.add("tap");
  setTimeout(() => ui.markTodayBtn.classList.remove("tap"), 180);
}

function bindRipple() {
  document.querySelectorAll(".btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const old = btn.querySelector(".ripple");
      if (old) old.remove();
      const r = document.createElement("span");
      r.className = "ripple";
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      r.style.width = `${size}px`;
      r.style.height = `${size}px`;
      r.style.left = `${e.clientX - rect.left - size / 2}px`;
      r.style.top = `${e.clientY - rect.top - size / 2}px`;
      btn.appendChild(r);
      setTimeout(() => r.remove(), 460);
    });
  });
}

function bindEvents() {
  $("prevMonth").addEventListener("click", () => {
    if (state.viewMode === "week") {
      shiftWeek(-1);
      return;
    }
    if (state.currentMonth === 1) {
      state.currentMonth = 12;
      state.currentYear -= 1;
    } else state.currentMonth -= 1;
    state.selectedDate = "";
    state.firstPaint = true;
    ensureMonth();
    renderAll();
  });

  $("nextMonth").addEventListener("click", () => {
    if (state.viewMode === "week") {
      shiftWeek(1);
      return;
    }
    if (state.currentMonth === 12) {
      state.currentMonth = 1;
      state.currentYear += 1;
    } else state.currentMonth += 1;
    state.selectedDate = "";
    state.firstPaint = true;
    ensureMonth();
    renderAll();
  });

  ui.prevWeekBtn.addEventListener("click", () => shiftWeek(-1));
  ui.nextWeekBtn.addEventListener("click", () => shiftWeek(1));

  $("markTodayBtn").addEventListener("click", () => {
    const today = getTodayInfo();
    state.currentYear = today.year;
    state.currentMonth = today.month;
    state.selectedDate = today.date;

    const m = ensureMonth(monthKey(today.year, today.month));
    const set = new Set(m.workedDates);
    const alreadyWorked = set.has(today.date);
    if (alreadyWorked) set.delete(today.date);
    else set.add(today.date);
    m.workedDates = [...set].sort();

    saveAndRender().then(() => {
      flashTodayButton(!alreadyWorked);
      pulseTodayButton();
      showToast(alreadyWorked ? "已取消今日打卡" : "今日打卡成功", alreadyWorked ? "warn" : "success");
    });
  });

  ui.monthViewBtn.addEventListener("click", () => {
    if (state.minimalMode) return;
    state.viewMode = "month";
    state.firstPaint = true;
    saveAndRender();
  });

  ui.weekViewBtn.addEventListener("click", () => {
    state.viewMode = "week";
    state.firstPaint = true;
    if (!state.selectedDate) state.selectedDate = dateStr(state.currentYear, state.currentMonth, 1);
    saveAndRender();
  });

  ui.themeBtn.addEventListener("click", cycleTheme);
  ui.minimalBtn.addEventListener("click", () => {
    applyMinimalMode(!state.minimalMode);
    saveAndRender();
  });

  ui.dailyWage.addEventListener("change", () => {
    const v = numOrNull(ui.dailyWage.value);
    if (v == null) {
      showToast("默认日薪必须是非负数字", "warn");
      renderAll();
      return;
    }
    ensureMonth().dailyWage = v;
    saveAndRender();
  });

  ui.selectedIncome.addEventListener("change", () => {
    if (!state.selectedDate) return;
    const m = monthDataByDateStr(state.selectedDate);
    if (ui.selectedIncome.value === "") {
      delete m.dailyIncomeMap[state.selectedDate];
      saveAndRender();
      return;
    }
    const v = numOrNull(ui.selectedIncome.value);
    if (v == null) {
      showToast("当日收入必须是非负数字", "warn");
      renderAll();
      return;
    }
    m.dailyIncomeMap[state.selectedDate] = v;
    saveAndRender();
  });

  $("clearBtn").addEventListener("click", () => {
    const m = ensureMonth();
    if (!m.workedDates.length && !Object.keys(m.dailyIncomeMap).length) {
      showToast("本月没有可清空记录", "warn");
      return;
    }
    if (!confirm(`确定清空 ${monthKey()} 吗？`)) return;
    m.workedDates = [];
    m.dailyIncomeMap = {};
    saveAndRender();
  });

  $("exportBtn").addEventListener("click", exportJson);

  $("importInput").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object" || typeof parsed.months !== "object") throw new Error("格式错误");
      state.data = parsed;
      if (!state.data.settings) state.data.settings = { theme: "mist", viewMode: "month", minimalMode: false };
      state.theme = state.data.settings.theme || "mist";
      state.viewMode = state.data.settings.viewMode || "month";
      state.minimalMode = !!state.data.settings.minimalMode;
      state.minimalPrevViewMode = state.viewMode;
      applyTheme(state.theme);
      applyMinimalMode(state.minimalMode);
      ensureMonth();
      await storageSet(state.data);
      renderAll();
      showToast("导入成功", "success");
    } catch (_err) {
      showToast("导入失败：JSON格式不正确", "warn");
    } finally {
      e.target.value = "";
    }
  });
}

async function init() {
  const now = new Date();
  state.currentYear = now.getFullYear();
  state.currentMonth = now.getMonth() + 1;
  state.selectedDate = dateStr(state.currentYear, state.currentMonth, now.getDate());

  const stored = await storageGet(KEY);
  if (stored && typeof stored === "object") state.data = stored;

  if (!state.data.settings) state.data.settings = { theme: "mist", viewMode: "month", minimalMode: false };
  state.theme = state.data.settings.theme || "mist";
  state.viewMode = state.data.settings.viewMode || "month";
  state.minimalMode = !!state.data.settings.minimalMode;
  state.minimalPrevViewMode = state.viewMode;

  applyTheme(state.theme);
  applyMinimalMode(state.minimalMode);
  renderWeekHead();
  ensureMonth();
  bindEvents();
  bindRipple();
  renderAll();
}

init();
