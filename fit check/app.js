const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const STORAGE_KEY = "fittrack-data-v1";
const CALORIE_GOAL = 2200;
const PROTEIN_GOAL = 110;
const REP_SCHEME = [20, 15, 12];

const initialData = {
  profileName: "Your fitness space",
  water: 0,
  calories: 0,
  protein: 0,
  weight: 66,
  goalWeight: 62,
  todayFocus: "Chest",
  workoutsDone: 0,
  completed: [],
  setsCompleted: {},
  setWeights: {},
  optionalAdded: [],
  personalRecords: {},
  workoutHistory: [],
  weightHistory: [],
  food: []
};

let data;
try {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  data = { ...initialData, ...stored };
} catch (error) {
  data = { ...initialData };
}

data.food = Array.isArray(data.food) ? data.food : [];
data.completed = Array.isArray(data.completed) ? data.completed : [];
data.setsCompleted = data.setsCompleted && typeof data.setsCompleted === "object" ? data.setsCompleted : {};
data.setWeights = data.setWeights && typeof data.setWeights === "object" ? data.setWeights : {};
data.optionalAdded = Array.isArray(data.optionalAdded) ? data.optionalAdded : [];
data.personalRecords = data.personalRecords && typeof data.personalRecords === "object" ? data.personalRecords : {};
data.workoutHistory = Array.isArray(data.workoutHistory) ? data.workoutHistory : [];
data.weightHistory = Array.isArray(data.weightHistory) ? data.weightHistory : [];

const workouts = [
  { name: "Flat Barbell Bench Press", group: "Chest", emoji: "🏋️", optional: false },
  { name: "Incline Barbell Bench Press", group: "Chest", emoji: "📈", optional: false },
  { name: "Decline Barbell Bench Press", group: "Chest", emoji: "↘️", optional: false },
  { name: "Cable Chest Fly", group: "Chest", emoji: "🔩", optional: false },
  { name: "Flat Dumbbell Chest Press", group: "Chest", emoji: "💪", optional: false },
  { name: "Push-Ups", group: "Chest", emoji: "🔥", optional: true },

  { name: "Wide-Grip Lat Pulldown", group: "Back", emoji: "🧗", optional: false },
  { name: "Seated Cable Row", group: "Back", emoji: "🚣", optional: false },
  { name: "Bent-Over Barbell Row", group: "Back", emoji: "🏋️", optional: false },
  { name: "Single-Arm Dumbbell Row", group: "Back", emoji: "💪", optional: false },
  { name: "Chest-Supported Row", group: "Back", emoji: "↔️", optional: false },
  { name: "Conventional Deadlift", group: "Back", emoji: "⚡", optional: true },

  { name: "Seated Dumbbell Shoulder Press", group: "Shoulders", emoji: "🏋️", optional: false },
  { name: "Dumbbell Lateral Raise", group: "Shoulders", emoji: "🪽", optional: false },
  { name: "Dumbbell Front Raise", group: "Shoulders", emoji: "⬆️", optional: false },
  { name: "Reverse Pec Deck Fly", group: "Shoulders", emoji: "🦅", optional: false },
  { name: "Cable Face Pull", group: "Shoulders", emoji: "↔️", optional: false },
  { name: "Arnold Press", group: "Shoulders", emoji: "💪", optional: true },

  { name: "Barbell Back Squat", group: "Legs", emoji: "🦵", optional: false },
  { name: "45-Degree Leg Press", group: "Legs", emoji: "🏋️", optional: false },
  { name: "Romanian Deadlift", group: "Legs", emoji: "⚡", optional: false },
  { name: "Seated Leg Curl", group: "Legs", emoji: "🦿", optional: false },
  { name: "Leg Extension", group: "Legs", emoji: "🦵", optional: false },
  { name: "Standing Calf Raise", group: "Legs", emoji: "⬆️", optional: true },

  { name: "Barbell Biceps Curl", group: "Biceps", emoji: "💪", optional: false },
  { name: "Alternating Dumbbell Curl", group: "Biceps", emoji: "🏋️", optional: false },
  { name: "Hammer Curl", group: "Biceps", emoji: "🔨", optional: false },
  { name: "EZ-Bar Preacher Curl", group: "Biceps", emoji: "🎯", optional: false },
  { name: "Concentration Curl", group: "Biceps", emoji: "💪", optional: false },
  { name: "Cable Biceps Curl", group: "Biceps", emoji: "🔩", optional: true },

  { name: "Rope Triceps Pushdown", group: "Triceps", emoji: "⚡", optional: false },
  { name: "Overhead Cable Triceps Extension", group: "Triceps", emoji: "🏋️", optional: false },
  { name: "EZ-Bar Skull Crusher", group: "Triceps", emoji: "💪", optional: false },
  { name: "Close-Grip Bench Press", group: "Triceps", emoji: "🏋️", optional: false },
  { name: "Dumbbell Triceps Kickback", group: "Triceps", emoji: "🔁", optional: false },
  { name: "Assisted Triceps Dips", group: "Triceps", emoji: "↘️", optional: true },

  { name: "Crunches", group: "Core", emoji: "🔥", optional: false },
  { name: "Reverse Crunches", group: "Core", emoji: "↗️", optional: false },
  { name: "Lying Leg Raises", group: "Core", emoji: "🦵", optional: false },
  { name: "Bicycle Crunches", group: "Core", emoji: "🚴", optional: false },
  { name: "Russian Twists", group: "Core", emoji: "🔄", optional: false },
  { name: "Mountain Climbers", group: "Core", emoji: "⛰️", optional: true }
];
const groups = ["Chest", "Back", "Shoulders", "Legs", "Biceps", "Triceps", "Core"];
const viewNames = { overview: "Dashboard", workouts: "Workout", nutrition: "Nutrition", progress: "Progress" };
let currentView = "overview";
let selectedGroup = groups.includes(data.todayFocus) ? data.todayFocus : "Chest";
let toastTimer = null;
let restRemaining = 60;
let restInterval = null;
let restRunning = false;

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    notify("Browser storage is unavailable. Your changes may not stay after refresh.");
  }
}
function notify(message) {
  const node = $("#toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 2400);
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function percent(value, goal) {
  return goal > 0 ? clamp(Math.round((value / goal) * 100), 0, 100) : 0;
}
function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}
function shortDate(key) {
  if (!key) return "";
  const date = new Date(key + "T12:00:00");
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
function daysAgoKey(offset) {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  return todayKey(date);
}
function thisWeekSessions() {
  if (!data.workoutHistory.length) return Number(data.workoutsDone) || 0;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  return data.workoutHistory.filter(item => new Date(item.date + "T12:00:00") >= start).length;
}
function meter(value, goal) {
  return '<div class="meter"><span style="width:' + percent(value, goal) + '%"></span></div>';
}
function metric(title, value, unit, foot, icon, progress, goal) {
  return '<article class="metric-card"><div class="metric-top"><span>' + title + '</span><span class="metric-icon">' + icon + '</span></div>' +
    '<div class="metric-value">' + value + ' <small>' + unit + '</small></div><div class="metric-foot">' + foot + '</div>' +
    (goal ? meter(progress, goal) : '') + '</article>';
}
function head(eyebrow, title, description, action = "") {
  return '<div class="page-head"><div><div class="eyebrow">' + eyebrow + '</div><h1>' + title + '</h1><p>' + description +
    '</p></div>' + action + '</div>';
}
function card(title, body, subtitle = "", action = "") {
  return '<section class="card"><div class="card-head"><div><div class="card-title">' + title + '</div>' +
    (subtitle ? '<div class="card-subtitle">' + subtitle + '</div>' : '') + '</div>' + action + '</div>' + body + '</section>';
}
function ring(value, goal, label) {
  return '<div class="ring-wrap"><div class="ring" style="--progress:' + percent(value, goal) + '%"><div class="ring-content"><strong>' +
    percent(value, goal) + '%</strong><small>' + label + '</small></div></div><div class="ring-legend">' +
    '<div class="legend-item"><span class="legend-dot"></span> Completed <strong>' + value + '</strong></div>' +
    '<div class="legend-item"><span class="legend-dot" style="background:#475747"></span> Goal <strong>' + goal + '</strong></div></div></div>';
}
function waterVisual() {
  return '<div class="water-glasses">' + Array.from({ length: 8 }, (_, index) =>
    '<div class="water-glass ' + (index < data.water ? "filled" : "") + '" title="Glass ' + (index + 1) + '"></div>'
  ).join("") + '</div>';
}
function mealCategory(item) {
  const value = item.mealType || item.meal || "Other";
  const labels = { breakfast: "Breakfast", lunch: "Lunch", evening: "Evening", dinner: "Dinner", snack: "Snacks" };
  return labels[String(value).toLowerCase()] || value;
}
function foodRows(limit = Infinity) {
  if (!data.food.length) return '<div class="empty">No meals logged yet. Add your first meal to start tracking.</div>';
  const groupsByMeal = ["Breakfast", "Lunch", "Evening", "Dinner", "Snacks", "Other"];
  const entries = data.food.map((item, index) => ({ item, index }));
  let shown = 0;
  return '<div class="food-list">' + groupsByMeal.map(category => {
    const list = entries.filter(entry => mealCategory(entry.item) === category);
    if (!list.length || shown >= limit) return "";
    const rows = list.slice().reverse().map(entry => {
      if (shown >= limit) return "";
      shown += 1;
      const item = entry.item;
      return '<div class="food-row"><div class="food-emoji">' + (item.emoji || "🍽️") + '</div><div class="food-desc"><b>' +
        escapeHtml(item.name) + '</b><small>' + escapeHtml(item.quantity || item.detail || category) + '</small></div><div class="food-number">' +
        Number(item.calories || 0) + ' kcal<small>' + Number(item.protein || 0) + 'g protein</small></div>' +
        '<button class="remove-food" type="button" data-food-remove="' + entry.index + '" aria-label="Remove ' + escapeHtml(item.name) + '">×</button></div>';
    }).join("");
    return rows ? '<div class="meal-group"><h3>' + category.toUpperCase() + '</h3>' + rows + '</div>' : "";
  }).join("") + '</div>';
}
function exerciseChecks(name) {
  const source = data.setsCompleted[name];
  const checks = Array.isArray(source) ? source.slice(0, 3) : [false, false, false];
  while (checks.length < 3) checks.push(false);
  return checks;
}
function exerciseWeights(name) {
  const source = data.setWeights[name];
  const weights = Array.isArray(source) ? source.slice(0, 3) : ["", "", ""];
  while (weights.length < 3) weights.push("");
  return weights;
}
function completedExerciseCount(group = null) {
  return workouts.filter(workout => {
    if (group && workout.group !== group) return false;
    if (workout.optional && !data.optionalAdded.includes(workout.name)) return false;
    return exerciseChecks(workout.name).every(Boolean);
  }).length;
}
function activeExercises(group = null) {
  return workouts.filter(workout => (!group || workout.group === group) &&
    (!workout.optional || data.optionalAdded.includes(workout.name)));
}
function exerciseCard(workout) {
  const checks = exerciseChecks(workout.name);
  const weights = exerciseWeights(workout.name);
  const finished = checks.filter(Boolean).length;
  const rows = REP_SCHEME.map((reps, index) => {
    return '<label class="set-row ' + (checks[index] ? "done" : "") + '">' +
      '<input type="checkbox" data-set-index="' + index + '" data-set-exercise="' + escapeHtml(workout.name) + '" ' +
      (checks[index] ? "checked" : "") + ' aria-label="Complete set ' + (index + 1) + ' for ' + escapeHtml(workout.name) + '">' +
      '<span>Set ' + (index + 1) + '</span><strong>' + reps + ' reps</strong>' +
      '<span class="weight-field"><input type="number" min="0" max="500" step="0.5" inputmode="decimal" placeholder="0" value="' +
      escapeHtml(weights[index]) + '" data-set-weight="' + escapeHtml(workout.name) + '" data-weight-index="' + index + '" aria-label="Weight in kilograms for set ' +
      (index + 1) + ' of ' + escapeHtml(workout.name) + '">kg</span></label>';
  }).join("");
  return '<article class="exercise-card"><div class="exercise-card-top"><div class="emoji">' + workout.emoji + '</div>' +
    (workout.optional ? '<span class="optional-chip">OPTIONAL</span>' : '') + '</div><h3>' + escapeHtml(workout.name) +
    '</h3><p>' + workout.group + ' · 3 sets · 20 / 15 / 12 reps</p><div class="set-count">' + finished + '/3 sets completed</div>' +
    '<div class="set-tracker">' + rows + '</div>' + meter(finished, 3) +
    (workout.optional ? '<button class="text-link" type="button" data-optional-remove="' + escapeHtml(workout.name) + '">Remove optional exercise</button>' : '') +
    '</article>';
}
function optionalPanel(group) {
  const optional = workouts.find(workout => workout.group === group && workout.optional);
  if (!optional) return "";
  if (data.optionalAdded.includes(optional.name)) return "";
  return '<details class="optional-panel"><summary>Add an optional ' + group + ' exercise</summary><div class="optional-panel-inner">' +
    '<article class="exercise-card optional-prompt"><div class="exercise-card-top"><div class="emoji">' + optional.emoji +
    '</div><span class="optional-chip">OPTIONAL</span></div><h3>' + escapeHtml(optional.name) +
    '</h3><p>Extra movement, only when you have time and energy.</p><button class="secondary-btn" type="button" data-optional-add="' +
    escapeHtml(optional.name) + '">＋ Add to this workout</button></article></div></details>';
}
function dashboardWorkout() {
  const today = data.workoutHistory.filter(item => item.date === todayKey());
  const last = today[today.length - 1];
  const focus = groups.includes(data.todayFocus) ? data.todayFocus : "Chest";
  return '<div class="workout-hero"><div class="workout-art">🏋️</div><div class="workout-info"><h3>' +
    (last ? escapeHtml(last.group) + " completed" : escapeHtml(focus) + " workout") + '</h3><p>' +
    (last ? last.completed + ' exercises · ' + shortDate(last.date) : '5 exercises · 3 sets each') +
    '</p><div class="chips"><span class="chip">20 / 15 / 12 reps</span><span class="chip">' + (last ? "Logged today" : "Ready when you are") +
    '</span></div></div></div><div class="row-note"><label class="field focus-field"><span class="field-label">TRAINING FOCUS</span><select id="today-focus">' +
    groups.map(group => '<option value="' + group + '"' + (group === focus ? " selected" : "") + '>' + group + '</option>').join("") +
    '</select></label><button class="primary-btn" type="button" data-go="workouts">Open workout →</button></div>';
}
function weeklyActivityChart() {
  const points = Array.from({ length: 7 }, (_, offset) => {
    const key = daysAgoKey(6 - offset);
    const sessions = data.workoutHistory.filter(item => item.date === key).length;
    const date = new Date(key + "T12:00:00");
    return { day: date.toLocaleDateString(undefined, { weekday: "short" }), value: sessions };
  });
  const max = Math.max(1, ...points.map(point => point.value));
  return '<div class="activity-bars">' + points.map(point => '<div class="bar-col"><div class="bar-track"><div class="bar-fill ' +
    (point.value ? "highlight" : "") + '" style="height:' + Math.max(5, point.value / max * 100) + '%"></div></div><div class="bar-day">' +
    point.day + '</div></div>').join("") + '</div>';
}
function renderOverview() {
  const weekly = thisWeekSessions();
  return head("YOUR DAILY CHECK-IN", "A little progress, every day.", "Your essentials in one place. Keep it simple and keep moving.",
    '<button class="primary-btn" type="button" data-go="workouts">Start workout →</button>') +
    '<div class="metrics">' +
      metric("CALORIES", data.calories, "kcal", "Goal: " + CALORIE_GOAL.toLocaleString() + " kcal", "◉", data.calories, CALORIE_GOAL) +
      metric("PROTEIN", data.protein, "g", "Goal: " + PROTEIN_GOAL + " g", "✳", data.protein, PROTEIN_GOAL) +
      metric("WATER", data.water, "/ 8 glasses", "Daily hydration habit", "♧", data.water, 8) +
      metric("WORKOUTS", weekly, "this week", "Sessions completed", "↗", weekly, 5) +
    '</div><div class="content-grid">' +
      card("Today's workout", dashboardWorkout(), "PICK YOUR TRAINING FOCUS") +
      card("Water tracker", ring(data.water, 8, "glasses") + waterVisual() +
        '<div class="water-control"><button class="secondary-btn" type="button" data-action="water-minus">−</button>' +
        '<button class="primary-btn" type="button" data-action="water-plus">＋ Add a glass</button></div>' +
        '<div class="water-count">' + Math.max(0, 8 - data.water) + ' glasses to your daily target</div>', "SMALL HABIT, BIG IMPACT") +
    '</div><div class="content-grid">' +
      card("Recent meals", foodRows(4), "TODAY'S FOOD LOG", '<button class="text-link" type="button" data-go="nutrition">See all →</button>') +
      card("Weekly activity", weeklyActivityChart(), "YOUR WORKOUT HISTORY", '<button class="text-link" type="button" data-go="progress">View progress →</button>') +
    '</div>';
}
function timerMarkup() {
  return '<div class="timer-card"><div class="timer-copy"><b>Rest timer</b><small id="rest-status">Take a breather between sets.</small></div><div class="timer-controls">' +
    '<span class="timer-clock" id="rest-clock">01:00</span><button class="secondary-btn" type="button" data-action="rest-start">Start</button>' +
    '<button class="secondary-btn" type="button" data-action="rest-pause">Pause</button><button class="ghost-btn" type="button" data-action="rest-reset">Reset</button>' +
    '<button class="ghost-btn" type="button" data-action="rest-add">+15s</button></div></div>';
}
function updateRestTimerDisplay() {
  const clock = $("#rest-clock");
  const status = $("#rest-status");
  if (!clock) return;
  const minutes = String(Math.floor(restRemaining / 60)).padStart(2, "0");
  const seconds = String(restRemaining % 60).padStart(2, "0");
  clock.textContent = minutes + ":" + seconds;
  if (status) status.textContent = restRunning ? "Rest timer is running." : restRemaining === 0 ? "Rest complete. Ready for the next set?" : "Paused or ready when you are.";
}
function startRest() {
  if (restRemaining <= 0) restRemaining = 60;
  if (restInterval) clearInterval(restInterval);
  restRunning = true;
  restInterval = setInterval(() => {
    restRemaining = Math.max(0, restRemaining - 1);
    updateRestTimerDisplay();
    if (restRemaining === 0) {
      clearInterval(restInterval);
      restInterval = null;
      restRunning = false;
      notify("Rest complete. Ready for your next set?");
    }
  }, 1000);
  updateRestTimerDisplay();
}
function pauseRest() {
  if (restInterval) clearInterval(restInterval);
  restInterval = null;
  restRunning = false;
  updateRestTimerDisplay();
}
function resetRest() {
  pauseRest();
  restRemaining = 60;
  updateRestTimerDisplay();
}
function renderWorkouts() {
  const current = selectedGroup;
  const list = activeExercises(current);
  const completed = completedExerciseCount(current);
  const required = list.length;
  const cards = list.map(exerciseCard).join("");
  return head("TRAINING PLAN", "Focus on one session.", "Choose a body part, record your weights and tick off each set.") +
    '<div class="workout-toolbar"><div><div class="eyebrow">BODY PART</div><select id="workout-group" class="group-select">' +
    groups.map(group => '<option value="' + group + '"' + (group === current ? " selected" : "") + '>' + group + '</option>').join("") +
    '</select></div><button class="ghost-btn" type="button" data-action="reset-workout">Reset this workout</button></div>' +
    '<div class="notice">Each exercise has 3 sets: <b>20, 15 and 12 reps.</b> Enter the weight you used for each set. Tick a set when it is complete. Use a manageable load and controlled form.</div>' +
    timerMarkup() +
    '<div class="row-note" style="margin-bottom:10px"><div><b style="font:800 13px Manrope,sans-serif">' + current + '</b>' +
    '<div class="card-subtitle">5 main exercises' + (data.optionalAdded.some(name => list.some(item => item.name === name)) ? ' + optional exercise' : '') + '</div></div>' +
    '<span class="chip">' + completed + ' / ' + required + ' completed</span></div>' +
    '<div class="exercise-grid">' + cards + '</div>' + optionalPanel(current) +
    '<div class="card" style="margin-top:13px"><div class="session-summary"><div><div class="card-title">Session summary</div>' +
    '<div class="card-subtitle">Complete all 3 sets for an exercise to finish it.</div></div><button class="primary-btn" type="button" data-action="finish-workout">Finish session ✓</button></div>' +
    meter(completed, required) + '</div>';
}
function nutritionSummary() {
  return '<div class="metrics">' +
    metric("CALORIES", data.calories, "kcal", "Goal: " + CALORIE_GOAL.toLocaleString() + " kcal", "◉", data.calories, CALORIE_GOAL) +
    metric("PROTEIN", data.protein, "g", "Goal: " + PROTEIN_GOAL + " g", "✳", data.protein, PROTEIN_GOAL) +
    metric("CALORIES LEFT", Math.max(0, CALORIE_GOAL - data.calories), "kcal", "Based on your daily goal", "↘", Math.max(0, CALORIE_GOAL - data.calories), CALORIE_GOAL) +
    metric("FOOD LOG", data.food.length, "entries", "Meals added today", "＋", data.food.length, 5) +
    '</div>';
}
function renderNutrition() {
  const form = '<form id="food-form"><div class="form-grid">' +
    '<div class="field full"><label for="food-name">FOOD NAME</label><input id="food-name" name="name" required maxlength="70" placeholder="e.g. Paneer bhurji"></div>' +
    '<div class="field"><label for="food-meal">MEAL</label><select id="food-meal" name="mealType"><option>Breakfast</option><option>Lunch</option><option>Evening</option><option>Dinner</option><option>Snacks</option></select></div>' +
    '<div class="field"><label for="food-quantity">QUANTITY / PORTION</label><input id="food-quantity" name="quantity" required maxlength="60" placeholder="e.g. 2 rotis, 100 g"></div>' +
    '<div class="field"><label for="food-cal">CALORIES (KCAL)</label><input id="food-cal" name="calories" type="number" min="0" max="10000" step="1" required placeholder="350"></div>' +
    '<div class="field"><label for="food-protein">PROTEIN (G)</label><input id="food-protein" name="protein" type="number" min="0" max="500" step="0.1" required placeholder="18"></div>' +
    '</div><div class="form-actions"><button class="primary-btn" type="submit">＋ Add meal</button></div></form>';
  return head("DAILY FUEL", "Nutrition made simple.", "Add what you eat, note the portion and keep an eye on protein.") +
    nutritionSummary() + '<div class="content-grid">' +
    card("Add a meal", form, "FOOD + PORTION + NUTRITION") +
    card("Today's food log", foodRows(), "REMOVE AN ENTRY WITH ×") +
    '</div><div class="notice">Calories and protein are estimates you enter. Check package labels or a reliable food database for more accurate values.</div>';
}
function recordsMarkup() {
  const records = Object.entries(data.personalRecords).filter(([, value]) => Number(value) > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!records.length) return '<div class="empty">Log weights during your workouts to start building your personal records.</div>';
  return '<div class="pr-list">' + records.map(([name, value]) => '<div class="pr-row"><span>' + escapeHtml(name) + '</span><strong>' + value + ' kg</strong></div>').join("") + '</div>';
}
function strengthComparison() {
  const latest = data.workoutHistory[data.workoutHistory.length - 1];
  if (!latest || !latest.volume) return '<div class="empty">Add weights to your sets and finish a session to compare training volume.</div>';
  const previous = data.workoutHistory.slice(0, -1).reverse().find(item => item.group === latest.group && item.volume);
  if (!previous) return '<div class="empty">Your next ' + escapeHtml(latest.group) + ' session will give you a comparison.</div>';
  const difference = latest.volume - previous.volume;
  const change = previous.volume > 0 ? Math.round(difference / previous.volume * 100) : 0;
  return '<div class="metric-value">' + (difference >= 0 ? "+" : "") + change + '% <small>vs previous ' + escapeHtml(latest.group) + ' session</small></div>' +
    '<div class="metric-foot">Logged volume: ' + Math.round(latest.volume).toLocaleString() + ' kg-reps · Previous: ' + Math.round(previous.volume).toLocaleString() + ' kg-reps</div>';
}
function weeklyProgressBars() {
  const days = Array.from({ length: 7 }, (_, offset) => {
    const key = daysAgoKey(6 - offset);
    const count = data.workoutHistory.filter(item => item.date === key).length;
    const day = new Date(key + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" });
    return { day, count };
  });
  const max = Math.max(1, ...days.map(item => item.count));
  return '<div class="activity-bars">' + days.map(item => '<div class="bar-col"><div class="bar-track"><div class="bar-fill ' +
    (item.count ? "highlight" : "") + '" style="height:' + Math.max(5, item.count / max * 100) + '%"></div></div><div class="bar-day">' +
    item.day + '</div></div>').join("") + '</div>';
}
function weightHistoryMarkup() {
  if (!data.weightHistory.length) return '<div class="empty">Save a weight check-in to start your weight trend.</div>';
  const points = data.weightHistory.slice(-7);
  const values = points.map(item => Number(item.weight));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = Math.max(1, high - low);
  const coordinates = points.map((item, index) => {
    const x = points.length === 1 ? 150 : 20 + index * (260 / (points.length - 1));
    const y = 78 - ((Number(item.weight) - low) / range) * 54;
    return { x, y, weight: Number(item.weight), date: item.date };
  });
  const polyline = coordinates.map(point => point.x + "," + point.y).join(" ");
  const svg = '<div class="weight-chart"><svg viewBox="0 0 300 105" role="img" aria-label="Weight trend chart">' +
    '<line x1="12" y1="80" x2="288" y2="80" stroke="#344034" stroke-width="1"/>' +
    '<polyline points="' + polyline + '" fill="none" stroke="#c4f36a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    coordinates.map(point => '<circle cx="' + point.x + '" cy="' + point.y + '" r="4" fill="#c4f36a" stroke="#172018" stroke-width="2"><title>' +
      point.weight + ' kg on ' + shortDate(point.date) + '</title></circle>').join("") + '</svg>' +
    '<div class="weight-chart-labels"><span>' + shortDate(points[0].date) + '</span><b>' + low + '–' + high + ' kg</b><span>' +
    shortDate(points[points.length - 1].date) + '</span></div></div>';
  const list = points.slice().reverse().slice(0, 5).map(item => '<div class="history-item"><div><b>' + shortDate(item.date) +
    '</b><small>Weight check-in</small></div><strong>' + item.weight + ' kg</strong></div>').join("");
  return svg + '<div class="history-list">' + list + '</div>';
}
function workoutHistoryMarkup() {
  if (!data.workoutHistory.length) return '<div class="empty">Your completed sessions will appear here.</div>';
  return '<div class="history-list">' + data.workoutHistory.slice(-6).reverse().map(item => '<div class="history-item"><div><b>' +
    escapeHtml(item.group) + ' workout</b><small>' + shortDate(item.date) + ' · ' + item.completed + ' exercises</small></div><strong>' +
    (item.volume ? Math.round(item.volume).toLocaleString() + ' kg-reps' : "Completed") + '</strong></div>').join("") + '</div>';
}
function renderProgress() {
  const monthStart = new Date();
  monthStart.setDate(monthStart.getDate() - 29);
  const monthly = data.workoutHistory.filter(item => new Date(item.date + "T12:00:00") >= monthStart).length;
  const weekly = thisWeekSessions();
  return head("YOUR HISTORY", "See your progress.", "Track consistency, weight changes and strength over time.") +
    '<div class="metrics">' +
    metric("THIS WEEK", weekly, "sessions", "Goal: 5 sessions", "↗", weekly, 5) +
    metric("THIS MONTH", monthly, "sessions", "Last 30 days", "▦", monthly, 20) +
    metric("CURRENT WEIGHT", data.weight, "kg", "Latest check-in", "◎", 0, 0) +
    metric("GOAL WEIGHT", data.goalWeight, "kg", "Your target", "⌖", 0, 0) +
    '</div><div class="content-grid">' +
    card("Weekly consistency", weeklyProgressBars(), "SESSIONS BY DAY") +
    card("Strength comparison", strengthComparison(), "TRAINING VOLUME") +
    card("Personal records", recordsMarkup(), "BEST WEIGHT LOGGED PER EXERCISE") +
    card("Weight trend", weightHistoryMarkup(), "YOUR CHECK-INS") +
    '</div><div class="section-title">Workout history</div><div class="card">' + workoutHistoryMarkup() + '</div>' +
    '<div class="section-title">Update body weight</div><div class="card"><form id="weight-form"><div class="form-grid">' +
    '<div class="field"><label for="weight-value">CURRENT WEIGHT (KG)</label><input id="weight-value" name="weight" type="number" min="20" max="350" step="0.1" value="' + data.weight + '" required></div>' +
    '<div class="field"><label for="goal-weight">GOAL WEIGHT (KG)</label><input id="goal-weight" name="goal" type="number" min="20" max="350" step="0.1" value="' + data.goalWeight + '" required></div>' +
    '</div><div class="form-actions"><button class="primary-btn" type="submit">Save check-in</button></div></form></div>';
}

function syncProfile() {
  const name = (data.profileName || "Your fitness space").trim() || "Your fitness space";
  const letter = name.charAt(0).toUpperCase();
  $("#profile-name").textContent = name;
  $("#profile-avatar").textContent = letter;
  $("#profile-modal-avatar").textContent = letter;
  $("#profile-modal-preview").textContent = name;
  $("#open-profile-top").textContent = letter;
}
function openProfile() {
  $("#profile-display-name").value = data.profileName || "Your fitness space";
  $("#profile-modal").hidden = false;
  closeProfileMenu();
  setTimeout(() => $("#profile-display-name").focus(), 0);
}
function closeProfile() {
  $("#profile-modal").hidden = true;
}
function closeProfileMenu() {
  $("#profile-menu").hidden = true;
  $("#profile-menu-toggle").setAttribute("aria-expanded", "false");
}
function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "fittrack-progress.json";
  link.click();
  URL.revokeObjectURL(url);
  notify("Your FitTrack data export is ready.");
}
function resetAppData() {
  if (!confirm("Reset all FitTrack data saved in this browser?")) return;
  data = { ...initialData, food: [], completed: [], setsCompleted: {}, setWeights: {}, optionalAdded: [], personalRecords: {}, workoutHistory: [], weightHistory: [] };
  selectedGroup = "Chest";
  save();
  render();
  closeProfileMenu();
  notify("FitTrack data has been reset.");
}
function render() {
  syncProfile();
  $("#crumb").textContent = viewNames[currentView];
  $$(".nav-item, .mobile-nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.view === currentView);
  });
  const views = { overview: renderOverview, workouts: renderWorkouts, nutrition: renderNutrition, progress: renderProgress };
  $("#view").innerHTML = views[currentView]();
  updateRestTimerDisplay();
}
function go(view) {
  if (!viewNames[view]) return;
  currentView = view;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function changeWater(amount) {
  data.water = clamp(Number(data.water || 0) + amount, 0, 30);
  save();
  render();
  notify(amount > 0 ? "Water logged." : "Water entry removed.");
}
function finishWorkout() {
  const list = activeExercises(selectedGroup);
  const completed = list.filter(workout => exerciseChecks(workout.name).every(Boolean));
  if (!completed.length) {
    notify("Complete all 3 sets of at least one exercise first.");
    return;
  }
  let volume = 0;
  const exerciseNames = completed.map(workout => workout.name);
  completed.forEach(workout => {
    const weights = exerciseWeights(workout.name);
    weights.forEach((weight, index) => {
      const numeric = Number(weight);
      if (Number.isFinite(numeric) && numeric > 0) volume += numeric * REP_SCHEME[index];
    });
  });
  const session = {
    date: todayKey(),
    group: selectedGroup,
    completed: completed.length,
    exercises: exerciseNames,
    volume: Math.round(volume * 10) / 10
  };
  data.workoutHistory.push(session);
  data.workoutsDone = data.workoutHistory.length;
  save();
  notify(selectedGroup + " session saved.");
  go("progress");
}
function resetSelectedWorkout() {
  if (!confirm("Clear the completed sets for " + selectedGroup + "?")) return;
  activeExercises(selectedGroup).forEach(workout => {
    data.setsCompleted[workout.name] = [false, false, false];
    data.completed = data.completed.filter(name => name !== workout.name);
  });
  save();
  render();
  notify(selectedGroup + " checklist reset.");
}
function addOptional(name) {
  if (!data.optionalAdded.includes(name)) data.optionalAdded.push(name);
  save();
  render();
  notify("Optional exercise added.");
}
function removeOptional(name) {
  data.optionalAdded = data.optionalAdded.filter(item => item !== name);
  save();
  render();
  notify("Optional exercise removed.");
}
function completeSet(name, index, checked) {
  const checks = exerciseChecks(name);
  checks[index] = checked;
  data.setsCompleted[name] = checks;
  let newRecord = false;
  if (checked) {
    const loggedWeight = Number(exerciseWeights(name)[index]);
    const previousRecord = Number(data.personalRecords[name] || 0);
    if (loggedWeight > 0 && loggedWeight > previousRecord) {
      data.personalRecords[name] = loggedWeight;
      newRecord = true;
    }
  }
  if (checks.every(Boolean)) {
    if (!data.completed.includes(name)) data.completed.push(name);
  } else {
    data.completed = data.completed.filter(item => item !== name);
  }
  save();
  if (checked) {
    restRemaining = 60;
    startRest();
  }
  render();
  notify(checked ? (newRecord ? "New personal record! Rest timer started." : "Set completed. Rest timer started.") : "Set unchecked.");
}
function updateSetWeight(name, index, value) {
  const weights = exerciseWeights(name);
  const numeric = value === "" ? "" : Number(value);
  if (numeric !== "" && (!Number.isFinite(numeric) || numeric < 0 || numeric > 500)) {
    notify("Enter a weight between 0 and 500 kg.");
    return;
  }
  weights[index] = numeric;
  data.setWeights[name] = weights;
  if (numeric !== "" && exerciseChecks(name)[index]) {
    const previous = Number(data.personalRecords[name] || 0);
    if (numeric > previous) {
      data.personalRecords[name] = numeric;
      notify("New personal record for " + name + "!");
    }
  }
  save();
}
function removeFood(index) {
  const item = data.food[index];
  if (!item) return;
  data.calories = Math.max(0, Number(data.calories || 0) - Number(item.calories || 0));
  data.protein = Math.max(0, Number(data.protein || 0) - Number(item.protein || 0));
  data.food.splice(index, 1);
  save();
  render();
  notify("Food entry removed.");
}
function addFood(form) {
  const values = new FormData(form);
  const name = String(values.get("name") || "").trim();
  const quantity = String(values.get("quantity") || "").trim();
  const calories = Number(values.get("calories"));
  const protein = Number(values.get("protein"));
  if (!name || !quantity || !Number.isFinite(calories) || !Number.isFinite(protein) || calories < 0 || protein < 0) {
    notify("Enter the food, portion, calories and protein.");
    return;
  }
  const mealType = String(values.get("mealType") || "Other");
  const emoji = mealType === "Breakfast" ? "🍳" : mealType === "Lunch" ? "🍲" : mealType === "Dinner" ? "🥗" : "🍽️";
  data.food.push({ id: Date.now(), name, quantity, mealType, calories, protein, emoji });
  data.calories = Number(data.calories || 0) + calories;
  data.protein = Number(data.protein || 0) + protein;
  save();
  render();
  notify("Meal added to your food log.");
}
function saveWeight(form) {
  const values = new FormData(form);
  const weight = Number(values.get("weight"));
  const goal = Number(values.get("goal"));
  if (weight < 20 || weight > 350 || goal < 20 || goal > 350 || !Number.isFinite(weight) || !Number.isFinite(goal)) {
    notify("Enter a valid weight and goal between 20 and 350 kg.");
    return;
  }
  const today = todayKey();
  if (data.weightHistory.length && data.weightHistory[data.weightHistory.length - 1].date === today) {
    data.weightHistory[data.weightHistory.length - 1].weight = weight;
  } else {
    data.weightHistory.push({ date: today, weight });
  }
  data.weight = weight;
  data.goalWeight = goal;
  save();
  render();
  notify("Weight check-in saved.");
}
function restAction(action) {
  if (action === "rest-start") startRest();
  if (action === "rest-pause") pauseRest();
  if (action === "rest-reset") resetRest();
  if (action === "rest-add") {
    restRemaining += 15;
    updateRestTimerDisplay();
  }
}

document.addEventListener("click", event => {
  const navigation = event.target.closest("[data-view]");
  if (navigation) {
    go(navigation.dataset.view);
    return;
  }
  const goButton = event.target.closest("[data-go]");
  if (goButton) {
    go(goButton.dataset.go);
    return;
  }
  const addOptionalButton = event.target.closest("[data-optional-add]");
  if (addOptionalButton) {
    addOptional(addOptionalButton.dataset.optionalAdd);
    return;
  }
  const removeOptionalButton = event.target.closest("[data-optional-remove]");
  if (removeOptionalButton) {
    removeOptional(removeOptionalButton.dataset.optionalRemove);
    return;
  }
  const removeFoodButton = event.target.closest("[data-food-remove]");
  if (removeFoodButton) {
    removeFood(Number(removeFoodButton.dataset.foodRemove));
    return;
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "water-plus") changeWater(1);
  if (action === "water-minus") changeWater(-1);
  if (action === "finish-workout") finishWorkout();
  if (action === "reset-workout") resetSelectedWorkout();
  if (action.startsWith("rest-")) restAction(action);
});

document.addEventListener("change", event => {
  const setToggle = event.target.closest("[data-set-index]");
  if (setToggle) {
    completeSet(setToggle.dataset.setExercise, Number(setToggle.dataset.setIndex), setToggle.checked);
    return;
  }
  const weightInput = event.target.closest("[data-set-weight]");
  if (weightInput) {
    updateSetWeight(weightInput.dataset.setWeight, Number(weightInput.dataset.weightIndex), weightInput.value);
    return;
  }
  if (event.target.id === "workout-group") {
    selectedGroup = groups.includes(event.target.value) ? event.target.value : "Chest";
    data.todayFocus = selectedGroup;
    save();
    render();
    return;
  }
  if (event.target.id === "today-focus") {
    data.todayFocus = event.target.value;
    selectedGroup = data.todayFocus;
    save();
  }
});

document.addEventListener("submit", event => {
  if (event.target.id === "food-form") {
    event.preventDefault();
    addFood(event.target);
  }
  if (event.target.id === "weight-form") {
    event.preventDefault();
    saveWeight(event.target);
  }
  if (event.target.id === "profile-form") {
    event.preventDefault();
    const name = String(new FormData(event.target).get("displayName") || "").trim();
    if (!name) return;
    data.profileName = name;
    save();
    syncProfile();
    closeProfile();
    notify("Profile saved.");
  }
});

$("#open-profile").addEventListener("click", openProfile);
$("#open-profile-top").addEventListener("click", openProfile);
$("#close-profile").addEventListener("click", closeProfile);
$("#cancel-profile").addEventListener("click", closeProfile);
$("#profile-modal").addEventListener("click", event => {
  if (event.target.id === "profile-modal") closeProfile();
});
$("#profile-menu-toggle").addEventListener("click", event => {
  event.stopPropagation();
  const menu = $("#profile-menu");
  const opening = menu.hidden;
  menu.hidden = !opening;
  $("#profile-menu-toggle").setAttribute("aria-expanded", String(opening));
});
$("#profile-menu").addEventListener("click", event => {
  const option = event.target.closest("[data-profile-action]");
  if (!option) return;
  closeProfileMenu();
  if (option.dataset.profileAction === "edit") openProfile();
  if (option.dataset.profileAction === "export") exportData();
  if (option.dataset.profileAction === "reset") resetAppData();
  if (option.dataset.profileAction === "about") {
    alert("FitTrack is a personal workout, nutrition and progress tracker. Your information is saved in this browser.");
  }
});
document.addEventListener("click", event => {
  if (!event.target.closest(".profile-wrap, .profile-actions")) closeProfileMenu();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeProfile();
    closeProfileMenu();
  }
});

render();
