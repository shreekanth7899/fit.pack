
"use strict";

// ── HELPERS ──────────────────────────────────
const $       = id => document.getElementById(id);
const genId   = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const genCode = () => { const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return 'FIT-'+Array.from({length:4},()=>c[Math.floor(Math.random()*c.length)]).join(''); };
function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

// Local date for any Date object
function localDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

// Date N days ago (local)
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDate(d);
}

// Get last N days as local date strings
function lastNDays(n) {
  const dates = [];
  for (let i = n-1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(localDate(d));
  }
  return dates;
}

const fmtDate = d  => new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'2-digit'});
const aColor  = n  => { const p=['#00e5a0','#00bfff','#ff5e5e','#ffd166','#c77dff','#ff9f1c','#2ec4b6','#e040fb']; let h=0; for(const c of n) h=(h<<5)-h+c.charCodeAt(0); return p[Math.abs(h)%p.length]; };
const inits   = n  => n.trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
const o2a     = o  => (!o||typeof o!=='object') ? [] : Object.values(o);
const norm    = s  => (s||'').trim().toLowerCase().replace(/\s+/g,' ');

const QUOTES = [
  '"The only bad workout is the one that didn\'t happen."',
  '"Your body can stand almost anything. It\'s your mind you have to convince."',
  '"Don\'t limit your challenges. Challenge your limits."',
  '"Sweat is just fat crying."',
  '"Train insane or remain the same."',
  '"The pain you feel today will be the strength you feel tomorrow."',
  '"Discipline is doing it even when you don\'t feel like it."',
  '"Eat clean, train mean, stay lean."',
  '"Small daily improvements lead to staggering long-term results."',
  '"Wake up with determination. Go to bed with satisfaction."',
];

const DAILY_HABITS = [
  { key:'wakeup',  emoji:'🌅', label:'Woke up on time'          },
  { key:'meal',    emoji:'🌿', label:'Had Dal / Sprouts meal'    },
  { key:'hobby',   emoji:'🎨', label:'Spent time on hobby'       },
  { key:'nophone', emoji:'📵', label:'No phone 1hr before bed'   },
  { key:'water',   emoji:'💧', label:'Drank 8 glasses of water'  },
];

const RETAIN_DAYS = 30; // Keep 30 days of data

// ── STATE ─────────────────────────────────────
const App = {
  roomCode:null, userId:null, isOwner:false,
  _room:null, _entered:false,
  alarms:[], alarmTimer:null, audioCtx:null, ringtoneTimer:null,
  _currentDay: today(),   // track current local date for midnight reset
  _midnightTimer: null,

  init() {
    $('todayDate').textContent = new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'});
    $('quoteText').textContent = QUOTES[Math.floor(Math.random()*QUOTES.length)];
    const def=new Date(); def.setMonth(def.getMonth()+3);
    ['cr_targetDate','jr_targetDate','g_targetDate'].forEach(id=>{ if($(id)) $(id).value=def.toISOString().split('T')[0]; });
    document.querySelectorAll('.dc').forEach(c=>c.addEventListener('click',()=>c.classList.toggle('on')));
    const tk=document.querySelector('.ticker'); if(tk) tk.innerHTML+=tk.innerHTML;
    this._injectMobileTabs();
    this._loadSession();
    this._initPWA();
    this._startMidnightWatcher();
  },

  // ── MIDNIGHT WATCHER ─────────────────────────
  // Detects when the date changes (midnight) while the app is open.
  // Re-renders Today tab with fresh empty state and prunes old data.
  _startMidnightWatcher() {
    clearInterval(this._midnightTimer);
    this._midnightTimer = setInterval(() => {
      const newDay = today();
      if (newDay !== this._currentDay) {
        console.log('📅 New day detected:', newDay, '— resetting today view');
        this._currentDay = newDay;
        // Update header date
        $('todayDate').textContent = new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'});
        // Re-render if in dashboard
        if (this._room && this._entered) {
          renderTodayWorkouts(this._room);
          renderHabits(this._room);
          Goals.render();
          // Prune old data for all members
          this._pruneOldData();
        }
      }
    }, 30000); // check every 30 seconds
  },

  // ── 30-DAY DATA PRUNER ───────────────────────
  // Runs on load + at midnight. Deletes workouts and habits older than 30 days.
  // Weight log is kept but capped to 30 entries.
  async _pruneOldData() {
    if (!this.roomCode || !this._room) return;
    const cutoff = daysAgo(RETAIN_DAYS); // "YYYY-MM-DD" 30 days ago
    const members = o2a(this._room.members);

    for (const m of members) {
      // Prune workouts
      const workoutDates = Object.keys(m.workouts || {});
      for (const dateKey of workoutDates) {
        if (dateKey < cutoff) {
          try {
            await db.ref(`rooms/${this.roomCode}/members/${m.id}/workouts/${dateKey}`).remove();
          } catch(e) { /* silent */ }
        }
      }
      // Prune habits
      const habitDates = Object.keys(m.habits || {});
      for (const dateKey of habitDates) {
        if (dateKey < cutoff) {
          try {
            await db.ref(`rooms/${this.roomCode}/members/${m.id}/habits/${dateKey}`).remove();
          } catch(e) { /* silent */ }
        }
      }
      // Prune weight log — keep only last 30 entries sorted by ts
      const logs = o2a(m.weightLog || {}).sort((a,b) => b.ts - a.ts);
      if (logs.length > RETAIN_DAYS) {
        const toDelete = logs.slice(RETAIN_DAYS); // entries beyond 30
        for (const entry of toDelete) {
          // Find the key for this entry
          const wlObj = m.weightLog || {};
          const key = Object.keys(wlObj).find(k => wlObj[k].ts === entry.ts);
          if (key) {
            try {
              await db.ref(`rooms/${this.roomCode}/members/${m.id}/weightLog/${key}`).remove();
            } catch(e) { /* silent */ }
          }
        }
      }
    }
  },

  _injectMobileTabs() {
    const main = document.querySelector('.dash-main');
    if (!main) return;
    const row = document.createElement('div');
    row.className = 'mobile-tabs-row';
    row.id = 'mobileTabs';
    row.innerHTML = `
      <button class="nav-tab active" data-tab="today" onclick="UI.switchTab('today',this)">📋</button>
      <button class="nav-tab" data-tab="goals" onclick="UI.switchTab('goals',this)">🎯</button>
      <button class="nav-tab" data-tab="insights" onclick="UI.switchTab('insights',this)">📊</button>
      <button class="nav-tab" data-tab="settings" onclick="UI.switchTab('settings',this)">⚙️</button>`;
    main.insertBefore(row, main.firstChild);
  },

  _loadSession() {
    try {
      const s=JSON.parse(localStorage.getItem('fp_s')||'null');
      if(s?.roomCode&&s?.userId){
        this.roomCode=s.roomCode; this.userId=s.userId; this.isOwner=!!s.isOwner;
        this.alarms=JSON.parse(localStorage.getItem('fp_alarms_'+s.userId)||'[]');
        this._subRoom();
      }
    } catch(e){ console.warn(e); }
  },

  saveSession() {
    localStorage.setItem('fp_s',JSON.stringify({roomCode:this.roomCode,userId:this.userId,isOwner:this.isOwner}));
    localStorage.setItem('fp_alarms_'+this.userId,JSON.stringify(this.alarms));
  },

  _subRoom() {
    db.ref('rooms/'+this.roomCode).off('value');
    db.ref('rooms/'+this.roomCode).on('value',snap=>{
      const data=snap.val();
      if(!data){ UI.toast('Room not found or deleted.','error'); this.clearSession(); showLanding(); return; }
      this._room=data;
      const me=data.members?.[this.userId], pend=data.pending?.[this.userId];
      if(me){
        if(!this._entered){ this._entered=true; enterDashboard(data); this._pruneOldData(); }
        else renderAll(data);
      } else if(pend){
        if($('pendingRoomCodeDisp')) $('pendingRoomCodeDisp').textContent=this.roomCode;
      } else {
        UI.toast('You were removed from the room by the owner.','error');
        this.clearSession(); showLanding();
      }
    });
  },

  clearSession() {
    if(this.roomCode) db.ref('rooms/'+this.roomCode).off('value');
    this.roomCode=null; this.userId=null; this.isOwner=false;
    this._room=null; this._entered=false;
    localStorage.removeItem('fp_s');
    clearInterval(this.alarmTimer);
  },

  startAlarmClock() {
    clearInterval(this.alarmTimer);
    this.alarmTimer=setInterval(()=>Alarm.check(),15000);
    Alarm.check();
  },

  _initPWA() {
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('sw.js').then(reg=>{
        this._pwaReady=true;
        this._updatePWAUI(true);
      }).catch(()=>{ this._updatePWAUI(false); });
    } else { this._updatePWAUI(false); }
  },

  _updatePWAUI(supported) {
    const badge=$('pwaBadge'), tip=$('pwaAlarmTip');
    if(supported){
      if(badge){ badge.textContent='🔔 Background'; badge.style.display='inline'; }
      if(tip){ tip.textContent='✅ Background alarms active — rings even when browser is closed!'; tip.classList.add('show'); }
    } else {
      if(badge){ badge.textContent='⚠️ Browser only'; badge.style.display='inline'; }
      if(tip){ tip.textContent='⚠️ Add to Home Screen (Install PWA) for background alarm support.'; tip.classList.add('show'); tip.style.color='var(--accent4)'; tip.style.background='rgba(255,209,102,.08)'; tip.style.borderColor='rgba(255,209,102,.25)'; }
    }
  },

  _syncAlarmsToSW() {
    if(!this._pwaReady) return;
    navigator.serviceWorker.ready.then(reg=>{
      if(reg.active) reg.active.postMessage({ type:'SYNC_ALARMS', alarms:this.alarms, userId:this.userId });
    }).catch(()=>{});
  },
};

// ── UI ────────────────────────────────────────
const UI = {
  openModal(id)  { $(id)?.classList.add('open'); },
  closeModal(id) { $(id)?.classList.remove('open'); },

  toast(msg,type='success') {
    const w=$('toastWrap'), t=document.createElement('div');
    t.className='toast '+type;
    t.innerHTML=`<span>${{success:'✅',info:'ℹ️',error:'❌'}[type]||'✅'}</span><span>${msg}</span>`;
    w.appendChild(t); setTimeout(()=>t.remove(),3800);
  },

  switchTab(tab, btn) {
    document.querySelectorAll('.nav-tab,.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll(`[data-tab="${tab}"]`).forEach(b=>b.classList.add('active'));
    $('panel-'+tab)?.classList.add('active');
    if(tab==='insights') Insights.render();
    if(tab==='settings'){ Alarm.renderList(); renderSettingsInfo(); }
    if(tab==='goals')    Goals.render();
    if(tab==='today')    renderHabits(App._room);
    $('sidebar').classList.remove('open');
    $('sidebarBackdrop').classList.remove('visible');
  },

  toggleSidebar() {
    const sb=$('sidebar'), bd=$('sidebarBackdrop');
    const open=sb.classList.toggle('open');
    bd.classList.toggle('visible',open);
  },

  toggleAddForm(){ $('addWorkoutForm').classList.toggle('open'); },
  bnav(btn){},
};

document.addEventListener('click',e=>{ if(e.target.classList.contains('overlay')) e.target.classList.remove('open'); });

if('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('message', e=>{
    if(e.data?.type==='RING_ALARM') Alarm.ring(e.data.time);
  });
}

// ── ROOMS ─────────────────────────────────────
const Rooms = {
  async create() {
    const name=$('cr_name').value.trim(), roomName=$('cr_roomname').value.trim(),
          height=parseFloat($('cr_height').value), weight=parseFloat($('cr_weight').value),
          targetWeight=parseFloat($('cr_targetWeight').value), targetDate=$('cr_targetDate').value;
    if(!name||!roomName||!height||!weight||!targetWeight||!targetDate){
      UI.toast('Please fill all required fields','error'); return;
    }
    const code=genCode(), uid=genId(), wid=genId();
    const member={
      id:uid, name, height, weight, targetWeight, targetDate,
      role:'owner', joinedAt:Date.now(), workouts:{},
      weightLog:{[wid]:{date:today(),weight,note:'Starting weight',ts:Date.now()}},
      goals:{wakeup:'06:00',workoutdays:5,water:8,sleep:8,targetWeight,targetDate},
      habits:{},
    };
    const roomData={code,name:roomName,ownerId:uid,createdAt:Date.now(),members:{[uid]:member},pending:{}};
    try {
      await db.ref('rooms/'+code).set(roomData);
      App.roomCode=code; App.userId=uid; App.isOwner=true;
      App._room=roomData; App._entered=true;
      App.saveSession(); UI.closeModal('createRoomModal');
      UI.toast('Room '+code+' created! 🎉');
      enterDashboard(roomData); App._subRoom();
      setTimeout(()=>UI.openModal('alarmPromptModal'),700);
    } catch(e){ UI.toast('Error: '+e.message,'error'); console.error(e); }
  },

  async lookup() {
    const code=$('jr_code').value.trim().toUpperCase();
    if(!code){ UI.toast('Enter a room code','error'); return; }
    try {
      const snap=await db.ref('rooms/'+code).once('value'), room=snap.val();
      if(!room){ UI.toast('Room not found. Check the code.','error'); return; }
      $('joinFoundName').textContent='🏠 Joining: '+room.name;
      $('joinFoundSection').style.display='block';
      $('jr_code').setAttribute('data-code',code);
    } catch(e){ UI.toast('Error: '+e.message,'error'); }
  },

  toggleJoinMode(mode) {
    $('rtogNew').classList.toggle('active',mode==='new');
    $('rtogReturn').classList.toggle('active',mode==='return');
    $('joinNewSection').style.display    = mode==='new'    ? '' : 'none';
    $('joinReturnSection').style.display = mode==='return' ? '' : 'none';
  },

  async join() {
    const code=$('jr_code').getAttribute('data-code');
    if(!code){ UI.toast('Find a room first','error'); return; }
    const name=$('jr_name').value.trim(), height=parseFloat($('jr_height').value),
          weight=parseFloat($('jr_weight').value), targetWeight=parseFloat($('jr_targetWeight').value),
          targetDate=$('jr_targetDate').value;
    if(!name||!height||!weight||!targetWeight||!targetDate){
      UI.toast('Fill all required fields','error'); return;
    }
    const snap=await db.ref('rooms/'+code+'/members').once('value');
    const members=snap.val()||{};
    const dup=Object.values(members).find(m=>norm(m.name)===norm(name)&&m.height===height);
    if(dup){
      App.roomCode=code; App.userId=dup.id; App.isOwner=dup.role==='owner';
      App.alarms=JSON.parse(localStorage.getItem('fp_alarms_'+dup.id)||'[]');
      App.saveSession(); UI.closeModal('joinRoomModal');
      App._entered=false; App._subRoom();
      UI.toast('Welcome back, '+dup.name+'! 👋'); return;
    }
    const psnap=await db.ref('rooms/'+code+'/pending').once('value');
    const pending=psnap.val()||{};
    const pdp=Object.values(pending).find(m=>norm(m.name)===norm(name)&&m.height===height);
    if(pdp){
      UI.toast('You already have a pending request.','info');
      App.roomCode=code; App.userId=pdp.id; App.isOwner=false;
      App.saveSession(); UI.closeModal('joinRoomModal');
      if($('pendingRoomCodeDisp')) $('pendingRoomCodeDisp').textContent=code;
      UI.openModal('pendingApprovalModal'); App._subRoom(); return;
    }
    const uid=genId(), wid=genId();
    const member={
      id:uid, name, height, weight, targetWeight, targetDate,
      role:'member', joinedAt:Date.now(), workouts:{},
      weightLog:{[wid]:{date:today(),weight,note:'Starting weight',ts:Date.now()}},
      goals:{wakeup:'06:00',workoutdays:5,water:8,sleep:8,targetWeight,targetDate},
      habits:{},
    };
    try {
      await db.ref('rooms/'+code+'/pending/'+uid).set(member);
      App.roomCode=code; App.userId=uid; App.isOwner=false;
      App.saveSession(); UI.closeModal('joinRoomModal');
      UI.toast('Request sent! Waiting for approval. ⏳','info');
      if($('pendingRoomCodeDisp')) $('pendingRoomCodeDisp').textContent=code;
      UI.openModal('pendingApprovalModal'); App._subRoom();
      setTimeout(()=>UI.openModal('alarmPromptModal'),800);
    } catch(e){ UI.toast('Error: '+e.message,'error'); }
  },

  async rejoin() {
    const code=$('jr_code').getAttribute('data-code');
    if(!code){ UI.toast('Find a room first','error'); return; }
    const name=$('ret_name').value.trim(), height=parseFloat($('ret_height').value);
    if(!name||!height){ UI.toast('Enter your name and height','error'); return; }
    try {
      const snap=await db.ref('rooms/'+code+'/members').once('value');
      const members=snap.val()||{};
      const match=Object.values(members).find(m=>norm(m.name)===norm(name)&&m.height===height);
      if(!match){ UI.toast('No match found. Check your exact name & height.','error'); return; }
      App.roomCode=code; App.userId=match.id; App.isOwner=match.role==='owner';
      App.alarms=JSON.parse(localStorage.getItem('fp_alarms_'+match.id)||'[]');
      App.saveSession(); App._entered=false;
      UI.closeModal('joinRoomModal'); App._subRoom();
      UI.toast('Welcome back, '+match.name+'! 👋');
    } catch(e){ UI.toast('Error: '+e.message,'error'); }
  },

  async approve(uid) {
    const m=App._room?.pending?.[uid]; if(!m) return;
    try {
      await db.ref('rooms/'+App.roomCode+'/members/'+uid).set({...m,role:'member'});
      await db.ref('rooms/'+App.roomCode+'/pending/'+uid).remove();
      UI.toast(m.name+' approved! 🎉');
    } catch(e){ UI.toast('Error: '+e.message,'error'); }
  },

  async reject(uid) {
    const m=App._room?.pending?.[uid];
    try {
      await db.ref('rooms/'+App.roomCode+'/pending/'+uid).remove();
      if(m) UI.toast(m.name+' removed.','info');
    } catch(e){ UI.toast('Error: '+e.message,'error'); }
  },

  async deleteMember(uid) {
    if(!App.isOwner){ UI.toast('Only the room owner can remove members.','error'); return; }
    const m=App._room?.members?.[uid]; if(!m) return;
    if(uid===App.userId){ UI.toast('Use Leave Room to exit yourself.','error'); return; }
    if(!confirm('Remove '+m.name+' from the room?')) return;
    try {
      await db.ref('rooms/'+App.roomCode+'/members/'+uid).remove();
      UI.toast(m.name+' removed.','info');
    } catch(e){ UI.toast('Error: '+e.message,'error'); }
  },
};

// ── WORKOUTS ──────────────────────────────────
const Workouts = {
  async add() {
    if(!isApproved()) return;
    const type=$('actType').value, duration=parseInt($('actDuration').value)||0,
          time=$('actTime').value, note=$('actNote').value.trim();
    if(!time){ UI.toast('Please set a time','error'); return; }
    const wid=genId();
    // Save under today's LOCAL date key
    const dateKey = today();
    const entry={id:wid,type,duration,time,note,done:false,ts:Date.now(),date:dateKey};
    try {
      await db.ref(`rooms/${App.roomCode}/members/${App.userId}/workouts/${dateKey}/${wid}`).set(entry);
      $('addWorkoutForm').classList.remove('open');
      $('actDuration').value=''; $('actTime').value=''; $('actNote').value='';
      UI.toast('Activity added! 💪');
    } catch(e){ UI.toast('Error: '+e.message,'error'); }
  },

  async toggleDone(wid) {
    if(!isApproved()) return;
    const dateKey = today();
    const w=App._room?.members?.[App.userId]?.workouts?.[dateKey]?.[wid]; if(!w) return;
    try {
      await db.ref(`rooms/${App.roomCode}/members/${App.userId}/workouts/${dateKey}/${wid}/done`).set(!w.done);
    } catch(e){ UI.toast('Error','error'); }
  },

  async delete(wid) {
    if(!isApproved()) return;
    const dateKey = today();
    try {
      await db.ref(`rooms/${App.roomCode}/members/${App.userId}/workouts/${dateKey}/${wid}`).remove();
      UI.toast('Removed','info');
    } catch(e){ UI.toast('Error','error'); }
  },
};

// ── HABITS ────────────────────────────────────
const Habits = {
  async toggle(key) {
    if(!isApproved()) return;
    const dateKey = today();
    const current=App._room?.members?.[App.userId]?.habits?.[dateKey]?.[key]||false;
    try {
      await db.ref(`rooms/${App.roomCode}/members/${App.userId}/habits/${dateKey}/${key}`).set(!current);
    } catch(e){ UI.toast('Error','error'); }
  },
};

// ── WEIGHT ────────────────────────────────────
const Weight = {
  async log() {
    if(!isApproved()) return;
    const w=parseFloat($('wm_weight').value), note=$('wm_note').value.trim();
    if(!w){ UI.toast('Enter weight','error'); return; }
    const wid=genId();
    try {
      await db.ref(`rooms/${App.roomCode}/members/${App.userId}/weightLog/${wid}`)
        .set({date:today(),weight:w,note,ts:Date.now()});
      await db.ref(`rooms/${App.roomCode}/members/${App.userId}/weight`).set(w);
      UI.closeModal('weightModal'); $('wm_weight').value=''; $('wm_note').value='';
      UI.toast('Weight logged! 📊');
    } catch(e){ UI.toast('Error: '+e.message,'error'); }
  },
};

// ── GOALS ─────────────────────────────────────
const Goals = {
  async save() {
    if(!isApproved()) return;
    const me=App._room?.members?.[App.userId];
    const g={
      wakeup:     $('g_wakeup').value||'06:00',
      workoutdays:parseInt($('g_workoutdays').value)||5,
      water:      parseInt($('g_water').value)||8,
      sleep:      parseInt($('g_sleep').value)||8,
      targetWeight:parseFloat($('g_targetWeight').value)||(me?.targetWeight||65),
      targetDate: $('g_targetDate').value||(me?.targetDate||''),
    };
    try {
      await db.ref(`rooms/${App.roomCode}/members/${App.userId}/goals`).set(g);
      await db.ref(`rooms/${App.roomCode}/members/${App.userId}/targetWeight`).set(g.targetWeight);
      await db.ref(`rooms/${App.roomCode}/members/${App.userId}/targetDate`).set(g.targetDate);
      UI.closeModal('goalsModal'); UI.toast('Goals saved! 🎯');
    } catch(e){ UI.toast('Error: '+e.message,'error'); }
  },

  render() {
    const me=App._room?.members?.[App.userId]; if(!me) return;
    const g=me.goals||{wakeup:'06:00',workoutdays:5,water:8,sleep:8};
    $('g_wakeup').value=g.wakeup||'06:00';
    $('g_workoutdays').value=g.workoutdays||5;
    $('g_water').value=g.water||8;
    $('g_sleep').value=g.sleep||8;
    $('g_targetWeight').value=g.targetWeight||me.targetWeight||'';
    $('g_targetDate').value=g.targetDate||me.targetDate||'';
    const d=today(), wks=o2a(me.workouts?.[d]);
    const dn=wks.filter(w=>w.done).length, tm=wks.filter(w=>w.done).reduce((s,w)=>s+(w.duration||0),0);
    const habits=me.habits?.[d]||{};
    const habitsDone=DAILY_HABITS.filter(h=>habits[h.key]).length;
    const prog=wProg(me), weekly=wklyCount(me);
    const cards=[
      {cls:'wakeup',icon:'🌅',title:'WAKE UP TIME',val:g.wakeup||'—',target:'target rise time',pct:0},
      {icon:'🏃',title:"TODAY'S ACTIVITIES",val:dn+'/'+wks.length,target:'done today',pct:wks.length?Math.round(dn/wks.length*100):0},
      {icon:'⏱️',title:'ACTIVE MINUTES',val:tm+'m',target:'today',pct:Math.min(100,Math.round(tm/60*100))},
      {icon:'📅',title:'WEEKLY WORKOUTS',val:weekly+'/'+(g.workoutdays||5),target:'days this week',pct:Math.round(weekly/(g.workoutdays||5)*100)},
      {icon:'✅',title:'DAILY HABITS',val:habitsDone+'/'+DAILY_HABITS.length,target:'habits done',pct:Math.round(habitsDone/DAILY_HABITS.length*100)},
      {icon:'⚖️',title:'WEIGHT GOAL',val:me.weight+'kg',target:'→ '+(me.targetWeight||g.targetWeight||'?')+'kg',pct:prog},
    ];
    $('goalsGrid').innerHTML=cards.map(c=>`
      <div class="goal-card ${c.cls||''}">
        <span class="gc-icon">${c.icon}</span>
        <div class="gc-title">${c.title}</div>
        <div class="gc-val">${c.val}</div>
        <div class="gc-target">${c.target}</div>
        <div class="prog-track" style="margin-top:10px"><div class="prog-fill" style="width:${Math.min(100,c.pct||0)}%"></div></div>
      </div>`).join('');
  },
};

// ── INSIGHTS ──────────────────────────────────
let iDays=7;
const Insights = {
  setDays(n,btn){
    iDays=n;
    document.querySelectorAll('#dayChips .chip').forEach(c=>c.classList.remove('active'));
    btn.classList.add('active'); this.render();
  },

  render() {
    const room=App._room; if(!room) return;
    const members=o2a(room.members);
    if(!members.length){
      $('insightsGrid').innerHTML='<div class="empty"><span class="empty-icon">👥</span><p>No members yet</p></div>';
      $('leaderboard').innerHTML=''; return;
    }
    // Use local dates
    const dates = lastNDays(iDays);

    const ranked=members.map(m=>{
      const done=dates.reduce((s,d)=>s+o2a(m.workouts?.[d]).filter(w=>w.done).length,0);
      const habDone=dates.reduce((s,d)=>s+DAILY_HABITS.filter(h=>m.habits?.[d]?.[h.key]).length,0);
      const prog=wProg(m);
      return{m,done,habDone,prog,score:done*8+habDone*3+prog};
    }).sort((a,b)=>b.score-a.score);

    const rc=['gold','silver','bronze'], re=['🥇','🥈','🥉'];
    $('leaderboard').innerHTML='<div class="lb-title">🏆 LEADERBOARD</div>'+ranked.map((r,i)=>{
      const col=aColor(r.m.name);
      return `<div class="lb-row">
        <div class="lb-rank ${rc[i]||''}">${re[i]||(i+1)}</div>
        <div class="m-avatar" style="background:${col}22;color:${col};border:1.5px solid ${col}44;width:36px;height:36px;flex-shrink:0">${inits(r.m.name)}</div>
        <div class="lb-info">
          <div class="lb-name">${r.m.name}${r.m.id===App.userId?' <span style="color:var(--accent);font-size:.7rem">(You)</span>':''}</div>
          <div class="lb-sub">${r.done} workouts · ${r.habDone} habits · ${r.prog}% weight</div>
        </div>
        <div class="lb-score">${r.score}pts</div>
      </div>`;
    }).join('');

    $('insightsGrid').innerHTML=members.map(m=>{
      const col=aColor(m.name), isMe=m.id===App.userId;
      const streak=dates.map(d=>{
        const ws=o2a(m.workouts?.[d]);
        if(!ws.length) return 'none';
        if(ws.every(w=>w.done)) return 'done';
        if(ws.some(w=>w.done)) return 'partial';
        return 'none';
      });
      const tA=dates.reduce((s,d)=>s+o2a(m.workouts?.[d]).filter(w=>w.done).length,0);
      const tM=dates.reduce((s,d)=>s+o2a(m.workouts?.[d]).filter(w=>w.done).reduce((a,w)=>a+(w.duration||0),0),0);
      const habTotal=dates.reduce((s,d)=>s+DAILY_HABITS.filter(h=>m.habits?.[d]?.[h.key]).length,0);
      const maxHab=dates.length*DAILY_HABITS.length;
      const habPct=maxHab?Math.round(habTotal/maxHab*100):0;
      const prog=wProg(m), lw=latW(m);

      return `<div class="insight-card">
        <div class="ic-header">
          <div class="m-avatar" style="background:${col}22;color:${col};border:2px solid ${col}55;width:42px;height:42px;font-size:.95rem">${inits(m.name)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:.92rem">${m.name}${isMe?' <span style="color:var(--accent);font-size:.7rem">(You)</span>':''}</div>
            <div style="font-size:.72rem;color:var(--muted)">${m.weight}kg → ${m.targetWeight||'?'}kg · now ${lw}kg</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-family:'Bebas Neue',sans-serif;font-size:1.5rem;color:${col}">${prog}%</div>
            <div style="font-size:.62rem;color:var(--muted2);text-transform:uppercase;letter-spacing:1px">weight goal</div>
          </div>
        </div>
        <div class="ic-stats">
          <div class="ic-stat"><div class="ic-stat-val" style="color:${col}">${streak.filter(s=>s==='done').length}</div><div class="ic-stat-key">Full Days</div></div>
          <div class="ic-stat"><div class="ic-stat-val" style="color:var(--accent4)">${tA}</div><div class="ic-stat-key">Activities</div></div>
          <div class="ic-stat"><div class="ic-stat-val" style="color:var(--accent2)">${tM}m</div><div class="ic-stat-key">Active</div></div>
        </div>
        <div style="font-size:.65rem;color:var(--muted2);margin-bottom:5px;letter-spacing:1px">STREAK — LAST ${iDays} DAYS</div>
        <div class="streak-bar">${streak.map(s=>`<div class="sd ${s==='done'?'done':s==='partial'?'partial':''}"></div>`).join('')}</div>
        <div class="habit-bar-wrap">
          <div class="habit-bar-label"><span>Habits</span><span>${habPct}%</span></div>
          <div class="prog-track"><div class="prog-fill" style="width:${habPct}%;background:linear-gradient(90deg,var(--accent4),#ff9f1c)"></div></div>
        </div>
        <div class="prog-label" style="margin-top:10px"><span>Weight Progress</span><span>${prog}%</span></div>
        <div class="prog-track"><div class="prog-fill" style="width:${prog}%;background:linear-gradient(90deg,${col},${col}99)"></div></div>
      </div>`;
    }).join('');
  },
};

// ── ALARM ─────────────────────────────────────
const Alarm = {
  save() {
    const time=$('alarm_time').value; if(!time){ UI.toast('Set a time!','error'); return; }
    const days=Array.from(document.querySelectorAll('#daySelector .dc.on')).map(d=>parseInt(d.dataset.d));
    if(!days.length){ UI.toast('Pick at least one day','error'); return; }
    App.alarms.push({id:genId(),time,days,active:true});
    App.saveSession(); App._syncAlarmsToSW();
    UI.closeModal('alarmModal'); UI.toast('Alarm set for '+time+' ⏰'); this.renderList();
  },
  delete(id){
    App.alarms=App.alarms.filter(a=>a.id!==id);
    App.saveSession(); App._syncAlarmsToSW();
    this.renderList(); UI.toast('Alarm deleted','info');
  },
  toggle(id){
    const a=App.alarms.find(x=>x.id===id);
    if(a){ a.active=!a.active; App.saveSession(); App._syncAlarmsToSW(); this.renderList(); }
  },
  check() {
    const now=new Date();
    const hh=String(now.getHours()).padStart(2,'0');
    const mm=String(now.getMinutes()).padStart(2,'0');
    const cur=hh+':'+mm, day=now.getDay();
    App.alarms.forEach(a=>{
      if(!a.active) return;
      if(a.time===cur&&a.days.includes(day)){
        const k='fp_ar_'+a.id+'_'+today();
        if(!sessionStorage.getItem(k)){ sessionStorage.setItem(k,'1'); this.ring(a.time); }
      }
    });
  },
  ring(t){ $('ringingTime').textContent=t; UI.openModal('alarmRingingModal'); this.playMelody(); },
  dismiss(){ UI.closeModal('alarmRingingModal'); this.stopMelody(); UI.toast("Let's GO! 💪 Time to crush it!",'success'); },
  playMelody() {
    try {
      App.audioCtx=new (window.AudioContext||window.webkitAudioContext)();
      const ctx=App.audioCtx;
      const notes=[[523,0,.18],[659,.2,.18],[784,.4,.18],[1047,.6,.36],[784,1,.18],[880,1.2,.18],[1047,1.4,.36],[523,1.85,.14],[659,2,.14],[784,2.15,.14],[1047,2.3,.28],[880,2.6,.14],[1047,2.75,.42]];
      const play=(off=0)=>notes.forEach(([f,s,d])=>{ const o=ctx.createOscillator(),g=ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.type='triangle'; o.frequency.value=f; const t=ctx.currentTime+off+s; g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(.28,t+.02); g.gain.linearRampToValueAtTime(0,t+d); o.start(t); o.stop(t+d+.05); });
      play(); let r=1; App.ringtoneTimer=setInterval(()=>{ if(r<30){play();r++;}else clearInterval(App.ringtoneTimer); },3400);
    } catch(e){ console.warn(e); }
  },
  stopMelody(){ clearInterval(App.ringtoneTimer); try{ App.audioCtx?.close(); }catch(e){} App.audioCtx=null; },
  renderList() {
    const el=$('alarmListEl'); if(!el) return;
    if(!App.alarms.length){ el.innerHTML='<div class="empty" style="padding:14px"><span class="empty-icon">⏰</span><p>No alarms set</p></div>'; return; }
    const dn=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    el.innerHTML=App.alarms.map(a=>`
      <div class="alarm-entry">
        <div style="flex:1"><div class="ae-time">${a.time}</div><span class="ae-days">${a.days.map(d=>dn[d]).join(', ')}</span></div>
        <div class="toggle-sw ${a.active?'on':''}" onclick="Alarm.toggle('${a.id}')"></div>
        <button class="ae-del" onclick="Alarm.delete('${a.id}')">🗑</button>
      </div>`).join('');
  },
};

// ── RENDER ────────────────────────────────────
function renderAll(room){
  renderSidebar(room); renderTodayWorkouts(room);
  renderHabits(room); renderWeightLog(room);
  Goals.render(); updateNavbar(room);
}

function renderSidebar(room) {
  const members=o2a(room.members), pending=o2a(room.pending);
  const mc=$('navMemberCount'); if(mc) mc.textContent=members.length;

  $('memberList').innerHTML=members.map(m=>{
    const col=aColor(m.name), isMe=m.id===App.userId, isOwnerM=m.role==='owner';
    const canDel=App.isOwner&&!isMe;
    return `<div class="member-item ${isMe?'me':''}">
      <div class="m-avatar" style="background:${col}22;color:${col};border:1.5px solid ${col}44">${inits(m.name)}</div>
      <div class="m-info">
        <div class="m-name">${m.name}${isMe?' (You)':''}</div>
        <div class="m-meta">${m.weight}kg → ${m.targetWeight||'?'}kg</div>
      </div>
      <span class="m-badge ${isOwnerM?'badge-owner':'badge-member'}">${isOwnerM?'Owner':'Member'}</span>
      ${canDel?`<button class="m-del-btn" onclick="Rooms.deleteMember('${m.id}')" title="Remove">✕</button>`:''}
    </div>`;
  }).join('')||'<div class="empty" style="padding:10px"><p>No members yet</p></div>';

  const pc=$('pendingCard');
  if(pending.length&&App.isOwner){
    pc.style.display=''; $('pendingCount').textContent=pending.length;
    $('pendingList').innerHTML=pending.map(m=>`
      <div class="pending-row">
        <div class="m-avatar" style="background:${aColor(m.name)}22;color:${aColor(m.name)}">${inits(m.name)}</div>
        <div class="p-info"><div class="p-name">${m.name}</div><div class="p-meta">${m.height}cm</div></div>
        <div class="pending-actions">
          <button class="pa-btn approve" onclick="Rooms.approve('${m.id}')">✓</button>
          <button class="pa-btn reject" onclick="Rooms.reject('${m.id}')">✕</button>
        </div>
      </div>`).join('');
  } else pc.style.display='none';

  const me=room.members?.[App.userId];
  if(me){
    const prog=wProg(me), bmi=(me.weight/((me.height/100)**2)).toFixed(1);
    $('myStats').innerHTML=`
      <div class="stat-row">
        <div class="stat-box"><div class="stat-val">${me.weight}</div><div class="stat-key">Current kg</div></div>
        <div class="stat-box"><div class="stat-val" style="color:var(--accent2)">${me.targetWeight||'?'}</div><div class="stat-key">Target kg</div></div>
      </div>
      <div class="stat-row">
        <div class="stat-box"><div class="stat-val" style="color:var(--accent4)">${bmi}</div><div class="stat-key">BMI</div></div>
        <div class="stat-box"><div class="stat-val">${prog}%</div><div class="stat-key">Progress</div></div>
      </div>
      <div class="prog-label" style="margin-top:6px"><span>Weight Goal</span><span style="color:var(--accent)">${prog}%</span></div>
      <div class="prog-track"><div class="prog-fill" style="width:${prog}%"></div></div>`;
  }
}

function renderTodayWorkouts(room) {
  const dateKey = today(); // LOCAL date
  const me=room.members?.[App.userId];
  const wks=o2a(me?.workouts?.[dateKey]);
  const el=$('workoutList');
  if(!wks.length){
    el.innerHTML='<div class="empty"><span class="empty-icon">🏃</span><p>No activities yet today. Hit "＋ Add" to start!</p></div>';
    return;
  }
  el.innerHTML=wks.sort((a,b)=>a.time>b.time?1:-1).map(w=>`
    <div class="workout-card">
      <div class="wc-row">
        <div class="wc-check ${w.done?'done':''}" onclick="Workouts.toggleDone('${w.id}')"></div>
        <div class="wc-info">
          <div class="wc-name ${w.done?'done':''}">${w.type}</div>
          <div class="wc-meta">${w.duration?w.duration+' mins':''}${w.note?' · '+w.note:''}</div>
        </div>
        <div class="wc-time">${w.time}</div>
        <button class="wc-del" onclick="Workouts.delete('${w.id}')">🗑</button>
      </div>
    </div>`).join('');
}

function renderHabits(room) {
  const el=$('habitChecks'), scoreEl=$('habitScore'); if(!el) return;
  const me=room?.members?.[App.userId];
  const dateKey = today(); // LOCAL date
  const habits=me?.habits?.[dateKey]||{};
  const done=DAILY_HABITS.filter(h=>habits[h.key]).length;
  if(scoreEl) scoreEl.textContent=done+'/'+DAILY_HABITS.length;
  el.innerHTML=DAILY_HABITS.map(h=>{
    const checked=!!habits[h.key];
    return `<div class="habit-item ${checked?'checked':''}" onclick="Habits.toggle('${h.key}')">
      <div class="habit-cb"></div>
      <span class="habit-emoji">${h.emoji}</span>
      <span class="habit-label">${h.label}</span>
    </div>`;
  }).join('');
}

function renderWeightLog(room) {
  const me=room.members?.[App.userId];
  // Sort by ts desc, show last 30 entries only
  const logs=o2a(me?.weightLog).sort((a,b)=>b.ts-a.ts).slice(0,RETAIN_DAYS);
  const el=$('weightList');
  if(!logs.length){
    el.innerHTML='<div class="empty"><span class="empty-icon">⚖️</span><p>No weight logged yet</p></div>';
    return;
  }
  el.innerHTML=logs.map((e,i)=>{
    const prev=logs[i+1]; let delta='';
    if(prev){
      const d=e.weight-prev.weight;
      delta=`<span class="wl-delta ${d<0?'delta-down':'delta-up'}">${d<0?'▼':'▲'} ${Math.abs(d).toFixed(1)}kg</span>`;
    }
    return `<div class="wl-entry">
      <div><div class="wl-date">${fmtDate(e.date)}</div>${e.note?`<div class="wl-note">${e.note}</div>`:''}</div>
      <div style="display:flex;align-items:center;gap:10px"><span class="wl-val">${e.weight}kg</span>${delta}</div>
    </div>`;
  }).join('');
}

function renderSettingsInfo(){ if($('settingsCode')) $('settingsCode').textContent=App.roomCode||'—'; }

function updateNavbar(room){
  if($('navCreateBtn')) $('navCreateBtn').style.display='none';
  if($('navJoinBtn'))   $('navJoinBtn').style.display='none';
  $('navTabs').style.display=''; $('navRoomInfo').style.display='';
  $('navRoomName').textContent=room.name; $('navRoomCode').textContent=App.roomCode;
  $('navAlarmBtn').style.display=''; $('navShareBtn').style.display='';
  $('navLeaveBtn').style.display=''; $('navMembersBtn').style.display='';
  $('sbRoomName').textContent=room.name; $('sbRoomCode').textContent=App.roomCode;
}

function enterDashboard(room){
  $('landingPage').style.display='none'; $('landingPage').classList.remove('active');
  $('dashboardPage').style.display=''; $('dashboardPage').classList.add('active');
  updateNavbar(room); renderAll(room); Alarm.renderList(); renderSettingsInfo();
  App.startAlarmClock();
}

function showLanding(){
  $('dashboardPage').style.display='none'; $('dashboardPage').classList.remove('active');
  $('landingPage').style.display=''; $('landingPage').classList.add('active');
  if($('navCreateBtn')) $('navCreateBtn').style.display='';
  if($('navJoinBtn'))   $('navJoinBtn').style.display='';
  ['navTabs','navRoomInfo','navAlarmBtn','navShareBtn','navLeaveBtn','navMembersBtn'].forEach(id=>{
    const el=$(id); if(el) el.style.display='none';
  });
}

function leaveRoom(){
  if(!confirm('Leave this room? You can rejoin with the room code + your name & height.')) return;
  App.clearSession(); showLanding(); UI.toast('Left the room','info');
}

function shareOnWhatsApp(){
  const code=App.roomCode, name=App._room?.name||'FitPack', url=encodeURIComponent(window.location.href);
  const msg=encodeURIComponent('💪 *Join my FitPack Squad!*\n\n🏠 Room: *'+name+'*\n🔑 Code: *'+code+'*\n\n👉 Open: '+decodeURIComponent(url)+'\nClick "Join with Code" → enter *'+code+'*\n\nLet\'s crush our goals together! 🔥');
  window.open('https://wa.me/?text='+msg,'_blank');
}

function copyCode(){ const c=App.roomCode; if(!c) return; navigator.clipboard.writeText(c).then(()=>UI.toast('Code copied!')).catch(()=>UI.toast(c,'info')); }

// ── UTILS ─────────────────────────────────────
function isApproved(){ const ok=!!App._room?.members?.[App.userId]; if(!ok) UI.toast('Pending owner approval.','info'); return ok; }

function wProg(m){
  const logs=o2a(m.weightLog).sort((a,b)=>a.ts-b.ts);
  const s=logs[0]?.weight??m.weight;
  const c=logs[logs.length-1]?.weight??m.weight;
  const d=s-(m.targetWeight||m.goals?.targetWeight||m.weight-1);
  if(d<=0) return 100;
  return Math.min(100,Math.max(0,Math.round((s-c)/d*100)));
}

function latW(m){
  const logs=o2a(m.weightLog).sort((a,b)=>b.ts-a.ts);
  return logs[0]?.weight??m.weight;
}

// FIX: Use local dates for weekly count (not toISOString/UTC)
function wklyCount(member){
  const now=new Date();
  // Start of this week (Sunday) in local time
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  let count=0;
  for(let i=0; i<7; i++){
    const d=new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate()+i);
    const key=localDate(d);
    if(o2a(member.workouts?.[key]).some(w=>w.done)) count++;
  }
  return count;
}

// ── BOOT ──────────────────────────────────────
window.addEventListener('DOMContentLoaded',()=>App.init());
