(() => {
  'use strict';
  const C = window.ShadowCurriculum;
  const V = window.ShadowVoice;
  const app = document.getElementById('app');
  const SAVE_KEY = 'romanShadowAcademyCurriculumV1';

  const defaultSave = {
    player: 'Roman',
    xp: 0,
    sessions: 0,
    totalCorrect: 0,
    totalAttempts: 0,
    lastPlayed: null,
    placementComplete: false,
    medals: [],
    skills: {}
  };

  let save = loadSave();
  let route = 'home';
  let tab = 'literacy';
  let mission = null;
  let modal = null;

  function loadSave() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      return { ...structuredClone(defaultSave), ...parsed, skills: parsed.skills || {}, medals: Array.isArray(parsed.medals) ? parsed.medals : [] };
    } catch { return structuredClone(defaultSave); }
  }
  function persist() { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }
  function skill(id) {
    return save.skills[id] || { attempts:0, correct:0, firstTryCorrect:0, streak:0, mastery:0, status:'training', lastPlayed:null };
  }
  function setSkill(id, value) { save.skills[id] = value; persist(); }
  function accuracy(s) { return s.attempts ? Math.round((s.correct/s.attempts)*100) : 0; }
  function masteryStatus(s) {
    if (s.mastery >= 80 && s.attempts >= 8) return 'mastered';
    if (s.attempts >= 3) return 'practicing';
    return 'training';
  }
  function unlocked(module) {
    return module.prereqs.every(id => skill(id).status === 'mastered');
  }
  function moduleById(id) { return C.MODULES.find(m=>m.id===id); }

  function makeStars() {
    const field = document.getElementById('stars');
    const layers = [
      { count: 60, cls: 'star',        min: 1.4, max: 2.6 },
      { count: 50, cls: 'star layer2', min: 1.0, max: 1.8 },
      { count: 40, cls: 'star layer3', min: 0.6, max: 1.2 },
      { count: 8,  cls: 'star bright', min: 2.4, max: 3.4 }
    ];
    layers.forEach(layer => {
      for (let i = 0; i < layer.count; i++) {
        const s = document.createElement('i'); s.className = layer.cls;
        const size = Math.random() * (layer.max - layer.min) + layer.min;
        Object.assign(s.style, { width: `${size}px`, height: `${size}px`, left: `${Math.random()*100}%`, top: `${Math.random()*100}%`, animationDelay: `${Math.random()*5}s` });
        field.appendChild(s);
      }
    });
    for (let i = 0; i < 2; i++) {
      const sh = document.createElement('i'); sh.className = 'shooting-star';
      Object.assign(sh.style, { left: `${55 + Math.random()*40}%`, top: `${5 + Math.random()*30}%`, animationDelay: `${3 + i*7 + Math.random()*4}s`, animationDuration: `${9 + Math.random()*6}s` });
      field.appendChild(sh);
    }
  }

  // The lightsaber progress bar: machined hilt + white-hot core blade.
  // The blade extends as the mission advances.
  function saberBar(percent, color, ignite) {
    return `<div class="saber ${color} ${ignite ? 'ignite' : ''}" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100" aria-label="Mission progress">
      <div class="saber-hilt">
        <span class="saber-pommel"></span><span class="saber-grip"></span><span class="saber-switch"></span><span class="saber-emitter"></span>
      </div>
      <div class="saber-blade-track"><div class="saber-blade" style="width:${percent}%"></div></div>
    </div>`;
  }

  // Spark burst where a correct answer lands — a tiny saber clash.
  function sparkBurst(button) {
    const wrap = document.createElement('span'); wrap.className = 'sparks';
    for (let i = 0; i < 10; i++) {
      const p = document.createElement('span'); p.className = 'spark';
      const angle = (Math.PI * 2 * i) / 10 + Math.random() * .5;
      const dist = 36 + Math.random() * 46;
      p.style.setProperty('--sx', `${Math.cos(angle)*dist}px`);
      p.style.setProperty('--sy', `${Math.sin(angle)*dist}px`);
      p.style.left = '50%'; p.style.top = '50%';
      wrap.appendChild(p);
    }
    button.style.position = 'relative';
    button.appendChild(wrap);
    setTimeout(() => wrap.remove(), 700);
  }

  const esc = value => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  function shell(content, options={}) {
    return `<div class="shell">
      <header class="topbar">
        <div class="brand"><h1>SHADOW ACADEMY</h1><p>${esc(options.subtitle || `${save.player}'s California Kindergarten Training`)}</p></div>
        <button class="icon-btn" data-action="settings" aria-label="Settings">⚙️</button>
      </header>
      ${content}
    </div>`;
  }

  function recommendedModule() {
    const order = ['placement','counting_ladder','letter_id','initial_sound','rhyme','number_id','number_sequence','compare','cvc_a','teen_numbers','addition5','sight_words','cvc_i','subtraction5','cvc_more','addition10','shapes'];
    if (!save.placementComplete) return moduleById('placement');
    return order.map(moduleById).find(m => m && m.id !== 'placement' && unlocked(m) && skill(m.id).status !== 'mastered') || moduleById('cvc_more');
  }

  function currentBand() { return Math.min(save.medals.length, C.BANDS.length - 1); }

  function renderHome() {
    route='home'; mission=null; V.stop();
    const rec=recommendedModule();
    const acc=save.totalAttempts ? Math.round(save.totalCorrect/save.totalAttempts*100) : 0;
    app.innerHTML=shell(`<section class="panel hero"><div class="hero-inner">
      <span class="badge">⚔️ Summer Curriculum Build</span>
      <h2>Welcome, ${esc(save.player)}.</h2>
      <div class="hero-saber">${saberBar(100,'blue',true)}</div>
      <div class="hero-characters">
        ${['hero','villain'].map(who=>`<img class="hero-char" src="images/${who}.png" alt="Academy ${who==='hero'?'hero':'rival'}"
          data-alts="images/${who}.jpg,images/${who}.jpeg,images/${who}.webp,images/${who}.avif"
          onerror="const a=(this.dataset.alts||'').split(',').filter(Boolean); if(a.length){this.src=a.shift(); this.dataset.alts=a.join(',');}else{this.remove();}">`).join('')}
      </div>
      <p>Train reading, phonics, number sense and early math through short adaptive missions.</p>
      <div class="button-grid">
        <button class="btn primary" data-action="start" data-module="${rec.id}">${rec.icon} ${rec.id==='placement'?'Begin Force Scan':`Continue: ${esc(rec.title)}`}</button>
        <button class="btn blue" data-action="modules">🗺️ Choose Training</button>
        <button class="btn gold" data-action="dashboard">📊 Parent Dashboard</button>
        <button class="btn ghost" data-action="quick-mix">✨ Mixed Mission</button>
      </div>
      <div class="cards" style="margin-top:18px">
        <div class="card"><div class="big">🏅</div><h3>${save.medals.length} of ${C.BANDS.length} Counting Medals</h3><p>${save.medals.length ? `Counted to ${C.BANDS[save.medals.length-1].hi}! Next stop: ${C.BANDS[Math.min(save.medals.length,C.BANDS.length-1)].hi}.` : 'Climb the Counting Ladder to earn your first medal.'}</p></div>
        <div class="card"><div class="big">🎯</div><h3>${acc}% Accuracy</h3><p>${save.totalAttempts} answered • ${save.xp} Academy XP</p></div>
      </div>
    </div></section>`);
    bind();
    welcomeOnce();
  }

  function renderModules() {
    route='modules'; V.stop();
    const modules=C.MODULES.filter(m=>m.domain===tab || m.domain==='mixed');
    app.innerHTML=shell(`<section class="panel" style="padding:18px;flex:1">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><button class="btn ghost small" data-action="home">← Home</button><h2 class="section-title">Training Map</h2><span></span></div>
      <div class="tabs"><button class="tab ${tab==='literacy'?'active':''}" data-action="tab" data-tab="literacy">Reading & Phonics</button><button class="tab ${tab==='math'?'active':''}" data-action="tab" data-tab="math">Numbers & Math</button></div>
      <div class="module-grid" style="margin-top:15px">${modules.map(moduleCard).join('')}</div>
    </section>`);
    bind();
  }

  function moduleCard(m) {
    const s=skill(m.id), isUnlocked=m.placement || unlocked(m), pct=Math.min(100,Math.round(s.mastery||0));
    return `<button class="module ${isUnlocked?'':'locked'}" ${isUnlocked?`data-action="start" data-module="${m.id}"`:''}>
      <div class="row"><span style="font-size:34px">${m.icon}</span><span class="status ${s.status}">${isUnlocked?esc(s.status):'locked'}</span></div>
      <h3>${esc(m.title)}</h3><p>${esc(m.description)}</p>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <div class="row meta" style="margin-top:8px"><span>${esc(m.standard)}</span><span>${accuracy(s)}%</span></div>
    </button>`;
  }

  function startMission(moduleId, mixed=false) {
    const module=moduleById(moduleId) || moduleById('letter_id');
    if (!module.placement && !unlocked(module)) return;
    save.sessions += 1; save.lastPlayed=new Date().toISOString(); persist();
    const ladderBand = module.id==='counting_ladder' ? C.BANDS[Math.min(save.medals.length, C.BANDS.length-1)] : null;
    mission={
      moduleId:module.id,
      title:mixed?'Mixed Mission':ladderBand?`Counting Ladder: ${ladderBand.lo} to ${ladderBand.hi}`:module.title,
      mixed,
      placement:module.placement,
      total:mixed?10:module.questions,
      index:0,
      correct:0,
      firstTryCorrect:0,
      current:null,
      wrongOnCurrent:false,
      locked:false,
      placementResults:{}
    };
    nextQuestion();
  }

  function mixedModule() {
    const available=C.MODULES.filter(m=>!m.placement && unlocked(m));
    return available[Math.floor(Math.random()*available.length)]?.id || 'letter_id';
  }

  function nextQuestion() {
    if (!mission || mission.index>=mission.total) return finishMission();
    const questionModule = mission.placement ? C.placementPlan[mission.index % C.placementPlan.length] : mission.mixed ? mixedModule() : mission.moduleId;
    mission.current=C.generate(questionModule, questionModule==='counting_ladder' ? {band: currentBand()} : {});
    mission.wrongOnCurrent=false; mission.locked=false;
    renderMission();
    setTimeout(()=>V.speak(mission.current.spoken,{slow:mission.current.slowSpeech}),520);
  }

  function normalizeChoice(choice) { return typeof choice==='object' ? choice.value : choice; }
  function choiceLabel(choice) { return typeof choice==='object' ? choice.label : choice; }
  function choiceAria(choice) { return typeof choice==='object' ? (choice.aria||choice.value) : choice; }

  function renderMission() {
    route='mission';
    const q=mission.current;
    const progress=Math.round((mission.index/mission.total)*100);
    const isMath=q.domain==='math';
    app.innerHTML=shell(`<section class="mission-shell">
      <div class="mission-head">
        <button class="icon-btn" data-action="quit" aria-label="Leave mission">←</button>
        <div class="mission-title"><strong>${esc(mission.title)}</strong><span>Challenge ${mission.index+1} of ${mission.total}</span></div>
        <button class="icon-btn" data-action="replay" aria-label="Repeat instructions">🔊</button>
      </div>
      ${saberBar(Math.max(progress,4), isMath?'green':'blue', mission.index===0)}
      <section class="panel question-panel">
        <span class="standard-chip">${esc(q.standard)}</span>
        <h2 class="prompt">${esc(q.prompt)}</h2>
        ${q.subprompt?`<p class="subprompt">${esc(q.subprompt)}</p>`:''}
        <div class="stimulus ${esc(q.stimulusType||'')}">${esc(q.stimulus)}</div>
        <div class="choices">${q.choices.map((c,i)=>`<button class="choice ${q.textChoices?'text':''}" data-action="answer" data-index="${i}" aria-label="${esc(choiceAria(c))}">${esc(choiceLabel(c))}</button>`).join('')}</div>
        <div class="feedback" id="feedback"></div>
      </section>
      <div class="mission-actions"><button class="btn ghost small" data-action="replay">🔊 Hear Again</button></div>
    </section>`,{subtitle:`${mission.placement?'Adaptive Placement':'Curriculum Mission'} • ${q.domain==='math'?'Math':'Reading'}`});
    bind();
  }

  function answer(index, button) {
    if (!mission || mission.locked) return;
    const q=mission.current;
    const selected=normalizeChoice(q.choices[index]);
    const correct=String(selected)===String(q.answer);
    const s={...skill(q.module)};
    s.attempts += 1; save.totalAttempts += 1;
    if (correct) {
      mission.locked=true;
      button.classList.add('correct');
      sparkBurst(button);
      s.correct += 1; save.totalCorrect += 1;
      if (!mission.wrongOnCurrent) { s.firstTryCorrect += 1; mission.firstTryCorrect += 1; }
      s.streak += 1; mission.correct += 1; save.xp += mission.wrongOnCurrent ? 5 : 10;
      const recentAccuracy=s.attempts?Math.round(s.correct/s.attempts*100):0;
      s.mastery=Math.min(100,Math.round(recentAccuracy*.75 + Math.min(25,s.streak*5)));
      s.status=masteryStatus(s); s.lastPlayed=new Date().toISOString(); setSkill(q.module,s); persist();
      const fb=document.getElementById('feedback'); fb.textContent=q.feedback; fb.className='feedback good';
      if (mission.placement) {
        const r=mission.placementResults[q.module] || {correct:0,total:0}; r.correct++; r.total++; mission.placementResults[q.module]=r;
      }
      // Let the coach finish her whole sentence, then breathe before moving on.
      const spokenFeedback=V.speak(q.feedback,{slow:q.slowSpeech});
      const minPause=new Promise(r=>setTimeout(r,1400));
      const thisMission=mission;
      Promise.all([spokenFeedback,minPause]).then(()=>{
        if (mission!==thisMission) return; // player left the mission while she was speaking
        setTimeout(()=>{ if (mission===thisMission){ mission.index++; nextQuestion(); } },450);
      });
    } else {
      mission.wrongOnCurrent=true; s.streak=0; s.mastery=Math.max(0,(s.mastery||0)-3); s.status=masteryStatus(s); s.lastPlayed=new Date().toISOString(); setSkill(q.module,s); persist();
      button.classList.add('wrong'); button.disabled=true;
      const fb=document.getElementById('feedback'); fb.textContent='Good try. Look carefully and try once more.'; fb.className='feedback try';
      V.speak('Good try. Look carefully and try once more.');
      if (mission.placement) {
        const r=mission.placementResults[q.module] || {correct:0,total:0}; r.total++; mission.placementResults[q.module]=r;
      }
    }
  }

  function finishMission() {
    V.stop();
    if (mission.placement) save.placementComplete=true;
    const pct=Math.round(mission.correct/mission.total*100);

    // Counting Ladder award: master this band of ten, earn the medal.
    let medalBanner='';
    let spokenLine=`${save.player}, training complete. You got ${mission.correct} out of ${mission.total}. Great work.`;
    const isLadder = mission.moduleId==='counting_ladder' && !mission.mixed && !mission.placement;
    if (isLadder && pct>=80 && save.medals.length < C.BANDS.length) {
      const band=C.BANDS[save.medals.length];
      save.medals.push(save.medals.length);
      const s={...skill('counting_ladder')};
      s.mastery=Math.round(save.medals.length / C.BANDS.length * 100);
      s.status=save.medals.length >= C.BANDS.length ? 'mastered' : 'practicing';
      s.lastPlayed=new Date().toISOString();
      setSkill('counting_ladder', s);
      medalBanner=`<div class="award">🏅 Counting Medal earned: ${band.lo} to ${band.hi}!</div>
        <p class="award-sub">${save.medals.length} of ${C.BANDS.length} medals on the climb to 150.</p>`;
      spokenLine=`${save.player}, you did it! You earned the ${band.lo} to ${band.hi} counting medal! You're such a superstar, and the coolest kid in the world.`;
    } else if (isLadder && pct<80) {
      spokenLine=`Great practice, ${save.player}. Let's try that band one more time and win the medal together.`;
    }
    persist();

    modal={pct};
    app.insertAdjacentHTML('beforeend',`<div class="modal-wrap"><section class="panel modal">
      <div class="medal">${medalBanner?'🏅':pct>=80?'🏆':pct>=60?'🥈':'🌟'}</div><h2>${medalBanner?'Medal Earned!':pct>=80?'Mission Mastered!':'Training Complete!'}</h2>
      ${medalBanner}
      ${saberBar(100, pct>=80?'green':'blue', true)}
      <p>${esc(save.player)} got ${mission.correct} of ${mission.total} correct. The Academy saved every skill for the parent dashboard.</p>
      <div class="button-grid"><button class="btn primary" data-action="retry">Train Again</button><button class="btn blue" data-action="dashboard">View Progress</button><button class="btn ghost" data-action="home">Academy Home</button></div>
    </section></div>`);
    bind();
    V.speak(spokenLine);
  }

  function renderDashboard() {
    route='dashboard'; V.stop();
    const modules=C.MODULES.filter(m=>!m.placement);
    const mastered=modules.filter(m=>skill(m.id).status==='mastered').length;
    const acc=save.totalAttempts?Math.round(save.totalCorrect/save.totalAttempts*100):0;
    app.innerHTML=shell(`<section class="panel" style="padding:18px;flex:1">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><button class="btn ghost small" data-action="home">← Home</button><h2 class="section-title">Parent Dashboard</h2><span></span></div>
      <div class="dashboard">
        <div class="stats"><div class="panel stat"><strong>${save.xp}</strong><span>Academy XP</span></div><div class="panel stat"><strong>${acc}%</strong><span>Accuracy</span></div><div class="panel stat"><strong>${mastered}</strong><span>Skills Mastered</span></div></div>
        <div class="tabs"><button class="tab ${tab==='literacy'?'active':''}" data-action="tab-dashboard" data-tab="literacy">Reading</button><button class="tab ${tab==='math'?'active':''}" data-action="tab-dashboard" data-tab="math">Math</button></div>
        <div class="card">${modules.filter(m=>m.domain===tab).map(m=>skillRow(m)).join('')}</div>
        <div class="card"><h3>How mastery works</h3><p>A skill moves toward mastery through repeated accuracy and a correct-answer streak. A wrong response lowers the estimate slightly and keeps the skill in review.</p></div>
        <button class="btn ghost small" data-action="export">Export Progress JSON</button>
      </div>
    </section>`);
    bind();
  }

  function skillRow(m) {
    const s=skill(m.id);
    return `<div class="skill-row"><div><strong>${m.icon} ${esc(m.title)}</strong><br><small>${s.correct}/${s.attempts} correct • ${esc(m.standard)}</small></div><div class="progress"><div style="width:${Math.round(s.mastery||0)}%"></div></div><span class="status ${s.status}">${esc(s.status)}</span></div>`;
  }

  function renderSettings() {
    route='settings'; V.stop();
    const settings=V.getSettings();
    const voiceOptions=V.getVoiceOptions();
    app.innerHTML=shell(`<section class="panel" style="padding:20px;flex:1">
      <div style="display:flex;align-items:center;justify-content:space-between"><button class="btn ghost small" data-action="home">← Home</button><h2 class="section-title">Academy Settings</h2><span></span></div>
      <div class="settings">
        <div class="field"><label for="player">Player name</label><input id="player" type="text" value="${esc(save.player)}" maxlength="20"></div>
        <div class="switch-row card"><div><strong>Voice prompts</strong><p>Read directions and feedback aloud.</p></div><input id="voiceEnabled" type="checkbox" ${settings.enabled?'checked':''}></div>
        <div class="field"><label for="voiceMode">Voice quality</label><select id="voiceMode"><option value="device" ${settings.mode==='device'?'selected':''}>Device voice — free and offline</option><option value="premium" ${settings.mode==='premium'?'selected':''}>Premium server voice — OpenAI or ElevenLabs</option></select><small>Premium mode needs the included Node server and an API key stored in the server environment—not in this HTML file.</small></div>
        <div class="field"><label for="deviceVoice">Device voice</label><select id="deviceVoice"><option value="">Automatic best English voice</option>${voiceOptions.map(v=>`<option value="${esc(v.name)}" ${settings.deviceVoice===v.name?'selected':''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}</select></div>
        <div class="field"><label for="endpoint">Premium voice endpoint</label><input id="endpoint" type="text" value="${esc(settings.premiumEndpoint)}"><small>Keep this as /api/speech when using the included server.</small></div>
        <div class="button-grid"><button class="btn blue" data-action="save-settings">Save & Test Voice</button><button class="btn ghost" data-action="reset">Reset Progress</button></div>
      </div>
    </section>`);
    bind();
  }

  function exportProgress() {
    const blob=new Blob([JSON.stringify(save,null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='roman-shadow-academy-progress.json'; a.click(); URL.revokeObjectURL(a.href);
  }

  function bind() {
    app.querySelectorAll('[data-action]').forEach(el=>el.addEventListener('click',event=>{
      const target=event.currentTarget, action=target.dataset.action;
      if (action==='home') renderHome();
      if (action==='settings') renderSettings();
      if (action==='modules') renderModules();
      if (action==='dashboard') renderDashboard();
      if (action==='start') startMission(target.dataset.module);
      if (action==='quick-mix') startMission(mixedModule(),true);
      if (action==='tab') { tab=target.dataset.tab; renderModules(); }
      if (action==='tab-dashboard') { tab=target.dataset.tab; renderDashboard(); }
      if (action==='answer') answer(Number(target.dataset.index),target);
      if (action==='replay' && mission?.current) V.speak(mission.current.spoken,{slow:mission.current.slowSpeech});
      if (action==='quit') renderHome();
      if (action==='retry' && mission) startMission(mission.moduleId,mission.mixed);
      if (action==='export') exportProgress();
      if (action==='save-settings') {
        save.player=(document.getElementById('player').value||'Roman').trim(); persist();
        V.saveSettings({enabled:document.getElementById('voiceEnabled').checked,mode:document.getElementById('voiceMode').value,deviceVoice:document.getElementById('deviceVoice').value,premiumEndpoint:document.getElementById('endpoint').value||'/api/speech'});
        V.speak(`Voice ready. Welcome back, ${save.player}.`); setTimeout(renderHome,700);
      }
      if (action==='reset' && confirm('Reset all Shadow Academy progress?')) { localStorage.removeItem(SAVE_KEY); save=structuredClone(defaultSave); renderHome(); }
    }));
  }

  function welcomeOnce() {
    if (sessionStorage.getItem('shadowWelcomed')) return;
    const once=()=>{ sessionStorage.setItem('shadowWelcomed','1'); V.speak(`Hello ${save.player}. You're such a superstar, and the coolest kid in the world.`); document.removeEventListener('pointerdown',once); };
    document.addEventListener('pointerdown',once,{once:true});
  }

  makeStars(); renderHome();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
