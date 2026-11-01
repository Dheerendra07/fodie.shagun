const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const KEY = "fittrack-data-v1";
const initial = {water:4, calories:1240, protein:62, weight:66, goalWeight:62, workoutsDone:2, completed:[], food:[{name:"Banana shake",detail:"Milk · banana · roasted chana",calories:380,protein:16,emoji:"🥤"},{name:"Dal & rice",detail:"Lunch",calories:420,protein:17,emoji:"🍚"},{name:"Eggs & curd",detail:"Evening meal",calories:310,protein:25,emoji:"🥚"}], history:[{day:"Mon",value:35},{day:"Tue",value:65},{day:"Wed",value:45},{day:"Thu",value:80},{day:"Fri",value:55},{day:"Sat",value:25},{day:"Sun",value:15}]};
let data;
try { data = {...initial, ...JSON.parse(localStorage.getItem(KEY) || "{}")}; } catch { data = {...initial}; }
let currentView = "overview", toastTimer;
const workouts = [
  {name:"Bench Press",group:"Chest",sets:"3 sets × 12 reps",emoji:"🏋️"},
  {name:"Incline Dumbbell Press",group:"Chest",sets:"3 sets × 12 reps",emoji:"💪"},
  {name:"Cable Fly",group:"Chest",sets:"3 sets × 15 reps",emoji:"🔩"},
  {name:"Triceps Pushdown",group:"Triceps",sets:"3 sets × 12 reps",emoji:"⚡"},
  {name:"Lat Pulldown",group:"Back",sets:"3 sets × 12 reps",emoji:"🧗"},
  {name:"Seated Cable Row",group:"Back",sets:"3 sets × 12 reps",emoji:"🚣"},
  {name:"Shoulder Press",group:"Shoulders",sets:"3 sets × 12 reps",emoji:"🏋️"},
  {name:"Lateral Raises",group:"Shoulders",sets:"3 sets × 15 reps",emoji:"🪽"},
  {name:"Squats",group:"Legs",sets:"3 sets × 12 reps",emoji:"🦵"},
  {name:"Romanian Deadlift",group:"Legs",sets:"3 sets × 12 reps",emoji:"⚡"},
  {name:"Bicep Curls",group:"Arms",sets:"3 sets × 12 reps",emoji:"💪"},
  {name:"Plank",group:"Core",sets:"3 sets × 45 sec",emoji:"🧘"}
];
const viewNames = {overview:"Overview",workouts:"Workouts",nutrition:"Nutrition",hydration:"Hydration",progress:"Progress"};
function save(){localStorage.setItem(KEY,JSON.stringify(data));}
function notify(message){const el=$("#toast");el.textContent=message;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),2300);}
function pct(value,goal){return Math.max(0,Math.min(100,Math.round(value/goal*100)));}
function meter(value,goal){return '<div class="meter"><span style="width:'+pct(value,goal)+'%"></span></div>';}
function metric(title,value,unit,foot,icon,progress,goal){return '<article class="metric-card"><div class="metric-top"><span>'+title+'</span><span class="metric-icon">'+icon+'</span></div><div class="metric-value">'+value+' <small>'+unit+'</small></div><div class="metric-foot">'+foot+'</div>'+(goal?meter(progress,goal):'')+'</article>';}
function head(eyebrow,title,desc,action=''){return '<div class="page-head"><div><div class="eyebrow">'+eyebrow+'</div><h1>'+title+'</h1><p>'+desc+'</p></div>'+action+'</div>';}
function card(title,body,subtitle='',action=''){return '<section class="card"><div class="card-head"><div><div class="card-title">'+title+'</div>'+(subtitle?'<div class="card-subtitle">'+subtitle+'</div>':'')+'</div>'+action+'</div>'+body+'</section>';}
function foodRows(){if(!data.food.length)return '<div class="empty">Your food log is empty. Add your first meal to get started.</div>';return data.food.slice().reverse().map(f=>'<div class="food-row"><div class="food-emoji">'+(f.emoji||'🍽️')+'</div><div class="food-desc"><b>'+escapeHtml(f.name)+'</b><small>'+escapeHtml(f.detail||'Food log')+'</small></div><div class="food-number">'+f.calories+' kcal<small>'+f.protein+'g protein</small></div></div>').join('');}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function waterVisual(){return '<div class="water-glasses">'+Array.from({length:8},(_,i)=>'<div class="water-glass '+(i<data.water?'filled':'')+'" title="Glass '+(i+1)+'"></div>').join('')+'</div>';}
function chart(){return '<div class="activity-bars">'+data.history.map((h,i)=>'<div class="bar-col"><div class="bar-track"><div class="bar-fill '+(i===5?'highlight':'')+'" style="height:'+Math.max(7,h.value)+'%"></div></div><div class="bar-day">'+h.day+'</div></div>').join('')+'</div>';}
function renderOverview(){
 const next=workouts.find(w=>!data.completed.includes(w.name))||workouts[0];
 return head('MONDAY, YOUR WAY','Let’s make today count. ✳','A little progress every day adds up. Here’s your fitness snapshot.','<button class="primary-btn" data-go="workouts">＋ Plan a workout</button>')+
 '<div class="metrics">'+metric('CALORIES EATEN',data.calories,'kcal','Daily goal: 2,200 kcal','◉',data.calories,2200)+metric('PROTEIN',data.protein,'g','Daily target: 110 g','✳',data.protein,110)+metric('WATER INTAKE',data.water,'/ 8 glasses','Keep sipping through the day','♧',data.water,8)+metric('WORKOUTS DONE',data.workoutsDone,'sessions','Weekly goal: 5 workouts','↗',data.workoutsDone,5)+'</div>'+
 '<div class="content-grid">'+card('Today’s workout','<div class="workout-hero"><div class="workout-art">🏋️</div><div class="workout-info"><h3>Strength & conditioning</h3><p>Build strength, one rep at a time.</p><div class="chips"><span class="chip">45–60 min</span><span class="chip">Beginner friendly</span></div></div></div><div class="row-note"><span class="muted">Suggested next: <b>'+next.name+'</b></span><button class="primary-btn" data-go="workouts">Open plan →</button></div>','YOUR TRAINING PLAN')+
 card('Daily hydration','<div class="ring-wrap"><div class="ring" style="--progress:'+pct(data.water,8)+'%"><div class="ring-content"><strong>'+pct(data.water,8)+'%</strong><small>daily goal</small></div></div><div class="ring-legend"><div class="legend-item"><span class="legend-dot"></span> Glasses finished <strong>'+data.water+'/8</strong></div><div class="legend-item"><span class="legend-dot" style="background:#475747"></span> Left to drink <strong>'+Math.max(0,8-data.water)+'</strong></div></div></div>'+waterVisual()+'<div class="water-control"><button class="secondary-btn" data-action="water-minus">−</button><button class="primary-btn" data-action="water-plus">＋ Add a glass</button></div>','SMALL HABITS, BIG IMPACT')+'</div>'+
 '<div class="content-grid">'+card('Recent food log',foodRows(), 'TODAY’S NUTRITION','<button class="text-link" data-go="nutrition">View all →</button>')+
 card('Your weekly movement',chart(),'ACTIVITY OVERVIEW','<button class="text-link" data-go="progress">See progress →</button>')+'</div>';
}
function renderWorkouts(){
 const groups=['All','Chest','Back','Shoulders','Legs','Arms','Core'];
 const selected=window.workoutFilter||'All';
 const list=workouts.filter(w=>selected==='All'||w.group===selected);
 return head('TRAINING SPACE','Your workout planner.','Build a routine that fits your day. Tick off each movement as you complete it.','<button class="ghost-btn" data-action="clear-workout">Reset checklist</button>')+
 '<div class="notice">💡 <b>Keep it smart:</b> Warm up first, use controlled form, and choose a weight you can lift safely. Rest between sets.</div>'+
 '<div class="chips filter-chips" style="margin-bottom:15px">'+groups.map(g=>'<button class="chip filter-chip '+(selected===g?'selected':'')+'" data-filter="'+g+'">'+g+'</button>').join('')+'</div>'+
 '<div class="exercise-grid">'+list.map(w=>'<article class="exercise-card"><div class="emoji">'+w.emoji+'</div><h3>'+w.name+'</h3><p>'+w.group+' · '+w.sets+'</p><button class="exercise-status '+(data.completed.includes(w.name)?'done':'')+'" data-exercise="'+w.name+'">'+(data.completed.includes(w.name)?'✓ Completed':'Mark complete')+'</button></article>').join('')+'</div>'+
 '<div class="section-title">Session summary</div><div class="card"><div class="row-note"><div><div class="card-title">'+data.completed.length+' exercises completed</div><div class="card-subtitle">Your checklist is saved in this browser.</div></div><button class="primary-btn" data-action="finish-workout">Finish session ✓</button></div>'+meter(data.completed.length,workouts.length)+'</div>';
}
function renderNutrition(){
 return head('FUEL YOUR BODY','Nutrition, without the guesswork.','Track meals and get a clearer picture of your daily fuel.','<button class="ghost-btn" data-action="clear-food">Clear today’s log</button>')+
 '<div class="metrics">'+metric('TOTAL CALORIES',data.calories,'kcal','Goal: 2,200 kcal','◉',data.calories,2200)+metric('PROTEIN',data.protein,'g','Goal: 110 g','✳',data.protein,110)+metric('CALORIES LEFT',Math.max(0,2200-data.calories),'kcal','Based on your daily goal','↘',Math.max(0,2200-data.calories),2200)+metric('MEALS LOGGED',data.food.length,'items','Add each meal or snack','＋',data.food.length,5)+'</div>'+
 '<div class="content-grid">'+card('Add a food entry','<form id="food-form"><div class="form-grid"><div class="field full"><label for="food-name">FOOD OR MEAL NAME</label><input id="food-name" name="name" required maxlength="70" placeholder="e.g. Paneer bhurji with roti"></div><div class="field"><label for="food-cal">CALORIES (KCAL)</label><input id="food-cal" name="calories" type="number" min="0" max="10000" required placeholder="350"></div><div class="field"><label for="food-protein">PROTEIN (GRAMS)</label><input id="food-protein" name="protein" type="number" min="0" max="500" required placeholder="18"></div><div class="field full"><label for="food-detail">MEAL NOTE (OPTIONAL)</label><input id="food-detail" name="detail" maxlength="100" placeholder="Breakfast, post-workout, snack…"></div></div><div class="form-actions"><button class="primary-btn" type="submit">＋ Add to food log</button></div></form>','LOG YOUR MEAL')+
 card('Your food log',foodRows(),'RECENT ENTRIES')+'</div><div class="notice">Nutrition values are estimates entered by you. Actual calories and protein depend on portions, recipes and preparation.</div>';
}
function renderHydration(){
 return head('HYDRATION CHECK','Stay topped up. 💧','A simple water tracker to help build a consistent hydration habit.','<button class="ghost-btn" data-action="water-reset">Reset today</button>')+
 '<div class="content-grid">'+card('Today’s water goal','<div class="ring-wrap"><div class="ring" style="--progress:'+pct(data.water,8)+'%"><div class="ring-content"><strong>'+pct(data.water,8)+'%</strong><small>completed</small></div></div><div class="ring-legend"><div class="legend-item">Drunk today <strong>'+data.water+' glasses</strong></div><div class="legend-item">Daily target <strong>8 glasses</strong></div><div class="legend-item">Remaining <strong>'+Math.max(0,8-data.water)+' glasses</strong></div></div></div>'+waterVisual()+'<div class="water-control"><button class="secondary-btn" data-action="water-minus">− Remove one</button><button class="primary-btn" data-action="water-plus">＋ Add a glass</button></div>','ONE GLASS AT A TIME')+
 card('Hydration reminders','<div class="exercise-list"><div class="exercise-row"><div class="exercise-symbol">☀</div><div class="exercise-main"><b>After waking up</b><small>Start your morning with a glass.</small></div></div><div class="exercise-row"><div class="exercise-symbol">🏋</div><div class="exercise-main"><b>Around your workout</b><small>Drink before, during and after exercise.</small></div></div><div class="exercise-row"><div class="exercise-symbol">🥗</div><div class="exercise-main"><b>With your meals</b><small>Make water part of your routine.</small></div></div><div class="exercise-row"><div class="exercise-symbol">🌙</div><div class="exercise-main"><b>Across the evening</b><small>Drink to thirst and fit your own needs.</small></div></div></div>','BUILD A ROUTINE')+'</div><div class="notice">Your fluid needs vary with activity, weather and health. Use this tracker as a habit aid, not a medical target.</div>';
}
function renderProgress(){
 return head('YOUR JOURNEY','Progress is more than a number.','Check in with your habits, strength and body weight over time.','<button class="ghost-btn" data-action="export-data">Export my data ↓</button>')+
 '<div class="metrics">'+metric('CURRENT WEIGHT',data.weight,'kg','Latest check-in','↗',data.weight,100)+metric('GOAL WEIGHT',data.goalWeight,'kg','Your personal target','◎',data.goalWeight,100)+metric('SESSIONS DONE',data.workoutsDone,'this week','Weekly target: 5','🏋',data.workoutsDone,5)+metric('EXERCISES TICKED',data.completed.length,'moves','Across your exercise list','✓',data.completed.length,workouts.length)+'</div>'+
 '<div class="content-grid">'+card('Weekly activity',chart(),'MOVEMENT, NOT PERFECTION')+
 card('Update your weight','<form id="weight-form"><div class="field"><label for="weight-value">CURRENT WEIGHT (KG)</label><input id="weight-value" name="weight" type="number" min="20" max="350" step=".1" required value="'+data.weight+'"></div><div class="field" style="margin-top:12px"><label for="goal-weight">GOAL WEIGHT (KG)</label><input id="goal-weight" name="goal" type="number" min="20" max="350" step=".1" required value="'+data.goalWeight+'"></div><div class="form-actions"><button class="primary-btn" type="submit">Save check-in</button></div></form>','YOUR CHECK-IN')+'</div>'+
 '<div class="section-title">Consistency checklist</div><div class="card"><div class="exercise-list">'+[['🏋️','Move your body','A workout or a walk counts.'],['🥗','Fuel your recovery','Aim for balanced meals and enough protein.'],['💧','Drink water regularly','Build a routine that suits your day.'],['😴','Make room for rest','Recovery is part of training.']].map(x=>'<div class="exercise-row"><div class="exercise-symbol">'+x[0]+'</div><div class="exercise-main"><b>'+x[1]+'</b><small>'+x[2]+'</small></div><span class="chip">Habit</span></div>').join('')+'</div></div>';
}
function render(){
 $('#crumb').textContent=viewNames[currentView];
 $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===currentView));
 const views={overview:renderOverview,workouts:renderWorkouts,nutrition:renderNutrition,hydration:renderHydration,progress:renderProgress};
 $('#view').innerHTML=views[currentView]();
}
function go(view){if(!viewNames[view])return;currentView=view;render();window.scrollTo({top:0,behavior:'smooth'});}
function waterChange(n){data.water=Math.max(0,Math.min(30,data.water+n));save();render();notify(n>0?'Water logged. Nice work!':'Water entry adjusted.');}
document.addEventListener('click',e=>{
 const nav=e.target.closest('[data-view]');if(nav){go(nav.dataset.view);return;}
 const goBtn=e.target.closest('[data-go]');if(goBtn){go(goBtn.dataset.go);return;}
 const filter=e.target.closest('[data-filter]');if(filter){window.workoutFilter=filter.dataset.filter;render();return;}
 const exercise=e.target.closest('[data-exercise]');if(exercise){const name=exercise.dataset.exercise;data.completed=data.completed.includes(name)?data.completed.filter(x=>x!==name):[...data.completed,name];save();render();notify(data.completed.includes(name)?'Exercise marked complete ✓':'Exercise unchecked');return;}
 const action=e.target.closest('[data-action]')?.dataset.action;if(!action)return;
 if(action==='water-plus')waterChange(1);
 if(action==='water-minus')waterChange(-1);
 if(action==='water-reset'){data.water=0;save();render();notify('Water tracker reset.');}
 if(action==='clear-workout'){data.completed=[];save();render();notify('Workout checklist reset.');}
 if(action==='finish-workout'){if(!data.completed.length){notify('Tick off at least one exercise first.');return;}data.workoutsDone=Math.min(7,data.workoutsDone+1);data.history[6].value=Math.min(100,data.history[6].value+20);save();render();notify('Session saved. Great job!');}
 if(action==='clear-food'){if(confirm('Clear all food entries and reset nutrition totals?')){data.food=[];data.calories=0;data.protein=0;save();render();notify('Food log cleared.');}}
 if(action==='export-data'){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='fittrack-progress.json';a.click();URL.revokeObjectURL(url);notify('Your data export is ready.');}
});
document.addEventListener('submit',e=>{
 if(e.target.id==='food-form'){e.preventDefault();const f=new FormData(e.target);const name=String(f.get('name')).trim(),calories=Number(f.get('calories')),protein=Number(f.get('protein'));if(!name||calories<0||protein<0)return;data.food.push({name,detail:String(f.get('detail')||'Food log').trim()||'Food log',calories,protein,emoji:'🍽️'});data.calories+=calories;data.protein+=protein;save();render();notify('Meal added to your food log!');}
 if(e.target.id==='weight-form'){e.preventDefault();const f=new FormData(e.target);const weight=Number(f.get('weight')),goal=Number(f.get('goal'));if(weight>=20&&weight<=350&&goal>=20&&goal<=350){data.weight=weight;data.goalWeight=goal;save();render();notify('Weight check-in saved.');}}
});
$('#reset-demo').addEventListener('click',()=>{if(confirm('Reset all FitTrack demo data in this browser?')){data=JSON.parse(JSON.stringify(initial));save();render();notify('Demo data has been reset.');}});
render();