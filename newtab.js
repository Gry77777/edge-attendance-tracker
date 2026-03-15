const WEEK = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const KEY = "work_attendance_itab_data";

const state = {
  currentYear: 0,
  currentMonth: 0,
  selectedDate: "",
  data: { months: {} }
};

const $ = (id) => document.getElementById(id);
const ui = {
  monthText: $("monthText"),
  workedDays: $("workedDays"),
  totalIncome: $("totalIncome"),
  prefilledIncome: $("prefilledIncome"),
  calendar: $("calendar"),
  weekHead: $("weekHead"),
  dailyWage: $("dailyWage"),
  selectedIncome: $("selectedIncome"),
  selectedDateLabel: $("selectedDateLabel"),
  recordTable: $("recordTable")
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

function ensureMonth(key = monthKey()) {
  if (!state.data.months[key]) {
    state.data.months[key] = { dailyWage: 0, workedDates: [], dailyIncomeMap: {} };
  }
  const m = state.data.months[key];
  if (!Array.isArray(m.workedDates)) m.workedDates = [];
  if (!m.dailyIncomeMap || typeof m.dailyIncomeMap !== "object") m.dailyIncomeMap = {};
  m.dailyWage = Number(m.dailyWage) >= 0 ? Number(m.dailyWage) : 0;
  return m;
}

function numberOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function calculateIncome(monthData) {
  let total = 0;
  let prefilled = 0;
  monthData.workedDates.forEach((d) => {
    if (Object.prototype.hasOwnProperty.call(monthData.dailyIncomeMap, d)) {
      const n = Number(monthData.dailyIncomeMap[d]) || 0;
      total += n;
      prefilled += n;
    } else {
      total += Number(monthData.dailyWage) || 0;
    }
  });
  return { total, prefilled };
}

function renderWeekHead() {
  ui.weekHead.innerHTML = "";
  WEEK.forEach((w) => {
    const div = document.createElement("div");
    div.textContent = w;
    ui.weekHead.appendChild(div);
  });
}

function renderCalendar() {
  ui.calendar.innerHTML = "";
  const y = state.currentYear;
  const m = state.currentMonth;
  const first = new Date(y, m - 1, 1);
  const total = new Date(y, m, 0).getDate();
  const firstWeekday = (first.getDay() + 6) % 7;
  const monthData = ensureMonth();
  const worked = new Set(monthData.workedDates);

  for (let i = 0; i < 42; i += 1) {
    const el = document.createElement("div");
    el.className = "day";
    if (i < firstWeekday || i >= firstWeekday + total) {
      el.classList.add("blank");
      ui.calendar.appendChild(el);
      continue;
    }

    const day = i - firstWeekday + 1;
    const dstr = dateStr(y, m, day);
    const col = i % 7;
    const isWeekend = col >= 5;
    const isWorked = worked.has(dstr);
    const isSelected = state.selectedDate === dstr;

    if (isWeekend) el.classList.add("weekend");
    if (isWorked) el.classList.add("worked");
    if (isSelected) el.classList.add("selected");

    const n = document.createElement("div");
    n.className = "num";
    n.textContent = String(day);

    const meta = document.createElement("div");
    meta.className = "meta";
    if (Object.prototype.hasOwnProperty.call(monthData.dailyIncomeMap, dstr)) {
      meta.textContent = `预填 ¥${Number(monthData.dailyIncomeMap[dstr]).toFixed(2)}`;
    } else {
      meta.textContent = isWorked ? "已打卡" : "未打卡";
    }

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
    ui.calendar.appendChild(el);
  }
}
function renderStatsAndForm() {
  const m = ensureMonth();
  const worked = m.workedDates.length;
  const money = calculateIncome(m);
  ui.workedDays.textContent = `${worked} 天`;
  ui.totalIncome.textContent = `¥ ${money.total.toFixed(2)}`;
  ui.prefilledIncome.textContent = `¥ ${money.prefilled.toFixed(2)}`;
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
}

function renderRecords() {
  const m = ensureMonth();
  const set = new Set([...m.workedDates, ...Object.keys(m.dailyIncomeMap)]);
  const rows = [...set].sort();

  ui.recordTable.innerHTML = "";
  const header = document.createElement("div");
  header.className = "record-row header";
  header.innerHTML = "<span>日期</span><span>星期</span><span>收入</span><span>状态</span>";
  ui.recordTable.appendChild(header);

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "record-row";
    empty.innerHTML = "<span>暂无记录</span><span>-</span><span>-</span><span>-</span>";
    ui.recordTable.appendChild(empty);
    return;
  }

  rows.forEach((d) => {
    const dt = new Date(`${d}T00:00:00`);
    const idx = (dt.getDay() + 6) % 7;
    const isWorked = m.workedDates.includes(d);
    const income = Object.prototype.hasOwnProperty.call(m.dailyIncomeMap, d)
      ? `¥ ${Number(m.dailyIncomeMap[d]).toFixed(2)}`
      : (isWorked ? "使用日薪" : "-");

    const row = document.createElement("div");
    row.className = "record-row";
    row.innerHTML = `<span>${d}</span><span>${WEEK[idx]}</span><span>${income}</span><span>${isWorked ? "已打卡" : "待打卡"}</span>`;
    row.addEventListener("click", () => {
      state.selectedDate = d;
      renderAll();
    });
    ui.recordTable.appendChild(row);
  });
}

function renderAll() {
  ui.monthText.textContent = monthKey();
  renderCalendar();
  renderStatsAndForm();
  renderRecords();
}

function saveAndRender() {
  return storageSet(state.data).then(renderAll);
}

function toggleWorked(dstr) {
  const m = ensureMonth();
  const set = new Set(m.workedDates);
  if (set.has(dstr)) set.delete(dstr);
  else set.add(dstr);
  m.workedDates = [...set].sort();
  saveAndRender();
}
function bindEvents() {
  $("prevMonth").addEventListener("click", () => {
    if (state.currentMonth === 1) {
      state.currentMonth = 12;
      state.currentYear -= 1;
    } else {
      state.currentMonth -= 1;
    }
    state.selectedDate = "";
    ensureMonth();
    renderAll();
  });

  $("nextMonth").addEventListener("click", () => {
    if (state.currentMonth === 12) {
      state.currentMonth = 1;
      state.currentYear += 1;
    } else {
      state.currentMonth += 1;
    }
    state.selectedDate = "";
    ensureMonth();
    renderAll();
  });

  $("markTodayBtn").addEventListener("click", () => {
    const t = new Date();
    state.currentYear = t.getFullYear();
    state.currentMonth = t.getMonth() + 1;
    const d = dateStr(state.currentYear, state.currentMonth, t.getDate());
    const m = ensureMonth();
    const set = new Set(m.workedDates);
    set.add(d);
    m.workedDates = [...set].sort();
    state.selectedDate = d;
    saveAndRender();
  });

  $("toggleWorkedBtn").addEventListener("click", () => {
    if (!state.selectedDate) return;
    toggleWorked(state.selectedDate);
  });

  ui.dailyWage.addEventListener("change", () => {
    const v = numberOrNull(ui.dailyWage.value);
    if (v == null) {
      alert("默认日薪必须是非负数字");
      renderAll();
      return;
    }
    ensureMonth().dailyWage = v;
    saveAndRender();
  });

  ui.selectedIncome.addEventListener("change", () => {
    if (!state.selectedDate) return;
    const m = ensureMonth();
    if (ui.selectedIncome.value === "") {
      delete m.dailyIncomeMap[state.selectedDate];
      saveAndRender();
      return;
    }
    const v = numberOrNull(ui.selectedIncome.value);
    if (v == null) {
      alert("当日收入必须是非负数字");
      renderAll();
      return;
    }
    m.dailyIncomeMap[state.selectedDate] = v;
    saveAndRender();
  });

  $("clearBtn").addEventListener("click", () => {
    const m = ensureMonth();
    if (!m.workedDates.length && !Object.keys(m.dailyIncomeMap).length) {
      alert("本月没有可清空记录");
      return;
    }
    if (!confirm(`确定清空 ${monthKey()} 吗？`)) return;
    m.workedDates = [];
    m.dailyIncomeMap = {};
    saveAndRender();
  });

  $("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $("importInput").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || typeof parsed.months !== "object") {
        throw new Error("格式错误");
      }
      state.data = parsed;
      ensureMonth();
      await storageSet(state.data);
      renderAll();
      alert("导入成功");
    } catch (err) {
      alert("导入失败：JSON格式不正确");
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
  if (stored && typeof stored === "object") {
    state.data = stored;
  }

  renderWeekHead();
  ensureMonth();
  bindEvents();
  renderAll();
}

init();
