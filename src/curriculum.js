/*
  Original Shadow Academy curriculum inspired by California kindergarten standards.
  The question generators create fresh practice rather than copying a commercial program.
*/
window.ShadowCurriculum = (() => {
  const LETTERS = [
    { upper:'A', lower:'a', word:'apple', emoji:'🍎', soundWord:'apple' },
    { upper:'B', lower:'b', word:'ball', emoji:'⚽', soundWord:'ball' },
    { upper:'C', lower:'c', word:'cat', emoji:'🐱', soundWord:'cat' },
    { upper:'D', lower:'d', word:'dog', emoji:'🐶', soundWord:'dog' },
    { upper:'E', lower:'e', word:'egg', emoji:'🥚', soundWord:'egg' },
    { upper:'F', lower:'f', word:'fish', emoji:'🐟', soundWord:'fish' },
    { upper:'G', lower:'g', word:'goat', emoji:'🐐', soundWord:'goat' },
    { upper:'H', lower:'h', word:'hat', emoji:'🎩', soundWord:'hat' },
    { upper:'I', lower:'i', word:'igloo', emoji:'🧊', soundWord:'igloo' },
    { upper:'J', lower:'j', word:'jet', emoji:'✈️', soundWord:'jet' },
    { upper:'K', lower:'k', word:'kite', emoji:'🪁', soundWord:'kite' },
    { upper:'L', lower:'l', word:'lion', emoji:'🦁', soundWord:'lion' },
    { upper:'M', lower:'m', word:'moon', emoji:'🌙', soundWord:'moon' },
    { upper:'N', lower:'n', word:'nest', emoji:'🪺', soundWord:'nest' },
    { upper:'O', lower:'o', word:'octopus', emoji:'🐙', soundWord:'octopus' },
    { upper:'P', lower:'p', word:'pig', emoji:'🐷', soundWord:'pig' },
    { upper:'Q', lower:'q', word:'queen', emoji:'👑', soundWord:'queen' },
    { upper:'R', lower:'r', word:'rocket', emoji:'🚀', soundWord:'rocket' },
    { upper:'S', lower:'s', word:'star', emoji:'⭐', soundWord:'star' },
    { upper:'T', lower:'t', word:'tree', emoji:'🌳', soundWord:'tree' },
    { upper:'U', lower:'u', word:'umbrella', emoji:'☂️', soundWord:'umbrella' },
    { upper:'V', lower:'v', word:'violin', emoji:'🎻', soundWord:'violin' },
    { upper:'W', lower:'w', word:'whale', emoji:'🐋', soundWord:'whale' },
    { upper:'X', lower:'x', word:'x-ray', emoji:'🩻', soundWord:'x-ray' },
    { upper:'Y', lower:'y', word:'yo-yo', emoji:'🪀', soundWord:'yo-yo' },
    { upper:'Z', lower:'z', word:'zebra', emoji:'🦓', soundWord:'zebra' }
  ];

  const CVC = {
    a: [
      ['cat','🐱'],['hat','🎩'],['map','🗺️'],['bag','🎒'],['bat','🦇'],['jam','🍓'],['fan','🪭'],['cap','🧢']
    ],
    i: [
      ['pig','🐷'],['sit','🪑'],['fin','🐟'],['lip','👄'],['six','6️⃣'],['wig','👩‍🦰'],['pin','📌'],['mix','🥣']
    ],
    o: [
      ['dog','🐶'],['fox','🦊'],['box','📦'],['mop','🧹'],['pot','🍲'],['log','🪵'],['top','🔝'],['hot','🔥']
    ],
    u: [
      ['sun','☀️'],['bug','🐛'],['cup','🥤'],['bus','🚌'],['rug','🧶'],['nut','🥜'],['run','🏃'],['mud','🟤']
    ],
    e: [
      ['hen','🐔'],['bed','🛏️'],['jet','✈️'],['leg','🦵'],['web','🕸️'],['pen','🖊️'],['red','🔴'],['ten','🔟']
    ]
  };

  const RHYME_SETS = [
    ['cat','hat','dog'], ['moon','spoon','star'], ['log','frog','fish'], ['cake','snake','sun'],
    ['bee','tree','car'], ['light','kite','book'], ['fox','box','pig'], ['run','sun','map']
  ];

  const SIGHT_WORDS = ['a','I','the','is','my','to','you','he','she','we','me','do','are','of','was','have'];
  const SHAPES = [
    ['circle','⚪'],['triangle','🔺'],['square','🟥'],['rectangle','▭'],['star','⭐'],['heart','❤️']
  ];

  const MODULES = [
    { id:'placement', domain:'mixed', title:'Force Scan', icon:'🧭', standard:'CA RF.K + K.CC', description:'A short adaptive check of letters, sounds, words and number sense.', prereqs:[], questions:12, placement:true },
    { id:'letter_id', domain:'literacy', title:'Letter Squadron', icon:'🔤', standard:'CA RF.K.1.d', description:'Recognize uppercase and lowercase letters in mixed order.', prereqs:[], questions:8 },
    { id:'initial_sound', domain:'literacy', title:'Sound Radar', icon:'📡', standard:'CA RF.K.2.d / RF.K.3.a', description:'Connect beginning sounds to letters and familiar pictures.', prereqs:['letter_id'], questions:8 },
    { id:'rhyme', domain:'literacy', title:'Rhyme Reactor', icon:'🎵', standard:'CA RF.K.2.a', description:'Hear and identify words that rhyme.', prereqs:[], questions:7 },
    { id:'cvc_a', domain:'literacy', title:'Short A Sector', icon:'🍎', standard:'CA RF.K.2.f / RF.K.3.b', description:'Blend and read simple short-a words.', prereqs:['initial_sound'], questions:8 },
    { id:'cvc_i', domain:'literacy', title:'Short I Sector', icon:'🐷', standard:'CA RF.K.2.f / RF.K.3.b', description:'Blend and read simple short-i words.', prereqs:['cvc_a'], questions:8 },
    { id:'cvc_more', domain:'literacy', title:'Vowel Worlds', icon:'🪐', standard:'CA RF.K.3.b', description:'Practice short o, u and e CVC words.', prereqs:['cvc_i'], questions:9 },
    { id:'sight_words', domain:'literacy', title:'Heart Word Vault', icon:'💛', standard:'CA RF.K.3.c', description:'Read common kindergarten high-frequency words.', prereqs:['letter_id'], questions:8 },
    { id:'counting_ladder', domain:'math', title:'Counting Ladder to 150', icon:'🏅', standard:'CA K.CC.1 / K.CC.2', description:'Climb ten numbers at a time. Earn a medal for every band you master.', prereqs:[], questions:10 },
    { id:'number_id', domain:'math', title:'Number Identity 0–100', icon:'💯', standard:'CA K.CC.1 / K.CC.3', description:'Recognize written numbers and connect names to numerals.', prereqs:[], questions:8 },
    { id:'number_sequence', domain:'math', title:'Hyperspace Sequence', icon:'🚀', standard:'CA K.CC.2', description:'Start from any number and find what comes before, after or next.', prereqs:['number_id'], questions:8 },
    { id:'compare', domain:'math', title:'Greater Force', icon:'⚖️', standard:'CA K.CC.6 / K.CC.7', description:'Compare numerals and groups using more, less and equal.', prereqs:['number_id'], questions:8 },
    { id:'teen_numbers', domain:'math', title:'Teen Number Base', icon:'🔟', standard:'CA K.NBT.1', description:'See 11–19 as one ten and extra ones.', prereqs:['number_id'], questions:8 },
    { id:'addition5', domain:'math', title:'Combine the Fleet', icon:'➕', standard:'CA K.OA.1 / K.OA.5', description:'Add within five using objects and equations.', prereqs:['compare'], questions:8 },
    { id:'subtraction5', domain:'math', title:'Ships Depart', icon:'➖', standard:'CA K.OA.1 / K.OA.5', description:'Subtract within five using take-away stories.', prereqs:['addition5'], questions:8 },
    { id:'addition10', domain:'math', title:'Power Within Ten', icon:'⚡', standard:'CA K.OA.2 / K.OA.4', description:'Solve addition and missing-part challenges within ten.', prereqs:['addition5'], questions:9 },
    { id:'shapes', domain:'math', title:'Galaxy Geometry', icon:'🔷', standard:'CA K.G.2 / K.G.4', description:'Name, compare and recognize common shapes.', prereqs:[], questions:7 }
  ];

  const rand = n => Math.floor(Math.random() * n);
  const sample = arr => arr[rand(arr.length)];
  const shuffled = arr => {
    const a = [...arr];
    for (let i=a.length-1;i>0;i--) { const j=rand(i+1); [a[i],a[j]]=[a[j],a[i]]; }
    return a;
  };
  const uniqueChoices = (answer, pool, count=4) => {
    const out = [answer];
    for (const x of shuffled(pool)) {
      if (!out.some(v => String(v) === String(x))) out.push(x);
      if (out.length >= count) break;
    }
    return shuffled(out);
  };

  function qBase(module, data) {
    return {
      id: `${module}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      module,
      domain: MODULES.find(m=>m.id===module)?.domain || 'mixed',
      ...data
    };
  }

  function letterId() {
    const target = sample(LETTERS);
    const uppercase = Math.random() > .5;
    const answer = uppercase ? target.upper : target.lower;
    const pool = LETTERS.map(x => uppercase ? x.upper : x.lower);
    return qBase('letter_id', {
      prompt:`Find the letter ${answer}.`,
      spoken:`Find the letter ${answer}.`,
      stimulus:'🔎', stimulusType:'',
      choices:uniqueChoices(answer, pool), answer,
      feedback:`Correct. That is the letter ${answer}.`, standard:'CA RF.K.1.d'
    });
  }

  function initialSound() {
    const target = sample(LETTERS.filter(x => !['Q','X'].includes(x.upper)));
    const distractors = shuffled(LETTERS.filter(x => x.upper !== target.upper)).slice(0,3);
    const askPicture = Math.random() > .45;
    if (askPicture) {
      return qBase('initial_sound', {
        prompt:`Which picture starts like ${target.word}?`,
        spoken:`Which picture begins with the same sound as ${target.word}?`,
        subprompt:`Listen to the first sound in “${target.word}.”`,
        stimulus:target.upper, stimulusType:'',
        choices:shuffled([target,...distractors]).map(x=>({label:x.emoji, value:x.word, aria:x.word})),
        answer:target.word,
        feedback:`Yes. ${target.word} starts with ${target.upper}.`, standard:'CA RF.K.2.d / RF.K.3.a'
      });
    }
    return qBase('initial_sound', {
      prompt:`Which letter starts ${target.word}?`,
      spoken:`Which letter is at the beginning of ${target.word}?`,
      stimulus:target.emoji, stimulusType:'',
      choices:uniqueChoices(target.upper, LETTERS.map(x=>x.upper)), answer:target.upper,
      feedback:`Yes. ${target.word} begins with ${target.upper}.`, standard:'CA RF.K.3.a'
    });
  }

  function rhyme() {
    const [a,b,c] = sample(RHYME_SETS);
    const answer = b;
    return qBase('rhyme', {
      prompt:`What rhymes with “${a}”?`,
      spoken:`What word rhymes with ${a}?`,
      stimulus:'🎵', stimulusType:'',
      choices:shuffled([b,c,sample(['ship','moon','red','ball','fish'])]), answer,
      feedback:`Right. ${a} and ${b} rhyme.`, standard:'CA RF.K.2.a'
    });
  }

  function cvc(vowel, module) {
    const list = CVC[vowel];
    const [word,emoji] = sample(list);
    const choiceMode = Math.random() > .45;
    if (choiceMode) {
      const pool = list.map(x=>x[0]);
      return qBase(module, {
        prompt:'Which word matches the picture?',
        spoken:`Choose the word ${word}.`,
        stimulus:emoji, stimulusType:'',
        choices:uniqueChoices(word,pool), answer:word,
        feedback:`Yes. ${word}.`, standard:'CA RF.K.2.f / RF.K.3.b', slowSpeech:true
      });
    }
    const chars = word.split('');
    const missing = rand(3);
    const shown = chars.map((c,i)=>i===missing?'_':c).join(' ');
    const answer = chars[missing];
    const letters = uniqueChoices(answer, LETTERS.map(x=>x.lower), 4);
    return qBase(module, {
      prompt:`Complete the word “${word}.”`,
      spoken:`Complete the word ${word}.`,
      subprompt:`Tap the missing letter.`,
      stimulus:shown, stimulusType:'word',
      choices:letters, answer,
      feedback:`Correct. ${word}.`, standard:'CA RF.K.3.a / RF.K.3.b', slowSpeech:true
    });
  }

  function sightWord() {
    const answer = sample(SIGHT_WORDS);
    return qBase('sight_words', {
      prompt:`Find the word “${answer}.”`, spoken:`Find the word ${answer}.`,
      stimulus:'💛', choices:uniqueChoices(answer,SIGHT_WORDS), answer,
      feedback:`Yes. The word is ${answer}.`, standard:'CA RF.K.3.c', slowSpeech:true
    });
  }

  // The Counting Ladder: 15 bands of ten, from 1–10 all the way to 141–150.
  // Each band is a medal Roman can earn. Questions stay inside his band so
  // the challenge always matches exactly where he is on the climb.
  const BANDS = Array.from({ length: 15 }, (_, i) => ({ lo: i * 10 + 1, hi: i * 10 + 10 }));

  function countingLadder(bandIndex = 0) {
    const band = BANDS[Math.max(0, Math.min(BANDS.length - 1, bandIndex))];
    const { lo, hi } = band;
    const bandPool = [];
    for (let i = Math.max(1, lo - 3); i <= hi + 3; i++) bandPool.push(i);
    const modes = lo === 1 ? ['count', 'count', 'next', 'tap'] : ['next', 'tap', 'before', 'missing'];
    const mode = sample(modes);

    if (mode === 'count') {
      const k = lo + rand(hi - lo + 1);
      const emoji = sample(['⭐', '🚀', '💎', '🤖']);
      return qBase('counting_ladder', {
        prompt: 'Count them. How many?', spoken: `Count with me. How many do you see?`,
        stimulus: emoji.repeat(k), stimulusType: 'objects',
        choices: uniqueChoices(k, bandPool), answer: k,
        feedback: `Yes! There are ${k}. Great counting!`, standard: 'CA K.CC.4'
      });
    }
    if (mode === 'next') {
      const n = lo - 1 + rand(hi - lo + 1); // includes the decade crossing, e.g. 29 → 30
      const shownN = Math.max(1, n);
      return qBase('counting_ladder', {
        prompt: `What comes after ${shownN}?`, spoken: `You are counting: ${Math.max(1, shownN - 1)}, ${shownN}... What comes next?`,
        stimulus: `${shownN}, __`, stimulusType: 'word',
        choices: uniqueChoices(shownN + 1, bandPool), answer: shownN + 1,
        feedback: `Yes! ${shownN + 1} comes after ${shownN}.`, standard: 'CA K.CC.2'
      });
    }
    if (mode === 'before') {
      const n = lo + 1 + rand(hi - lo - 1);
      return qBase('counting_ladder', {
        prompt: `What comes before ${n}?`, spoken: `What number comes right before ${n}?`,
        stimulus: `__, ${n}`, stimulusType: 'word',
        choices: uniqueChoices(n - 1, bandPool), answer: n - 1,
        feedback: `Yes! ${n - 1} comes before ${n}.`, standard: 'CA K.CC.2'
      });
    }
    if (mode === 'missing') {
      const n = lo + rand(Math.max(1, hi - lo - 2));
      return qBase('counting_ladder', {
        prompt: 'Find the missing number.', spoken: `Count along and find the missing number.`,
        stimulus: `${n}, __, ${n + 2}`, stimulusType: 'word',
        choices: uniqueChoices(n + 1, bandPool), answer: n + 1,
        feedback: `Yes! ${n}, ${n + 1}, ${n + 2}. Perfect counting!`, standard: 'CA K.CC.2'
      });
    }
    const target = lo + rand(hi - lo + 1);
    return qBase('counting_ladder', {
      prompt: `Tap ${target}.`, spoken: `Tap the number ${target}.`,
      stimulus: '🏅', stimulusType: '',
      choices: uniqueChoices(target, bandPool), answer: target,
      feedback: `Yes! That is ${target}.`, standard: 'CA K.CC.1 / K.CC.3'
    });
  }

  function numberId() {
    const ranges = [[0,20],[11,50],[51,100]];
    const [lo,hi] = sample(ranges);
    const answer = lo + rand(hi-lo+1);
    const pool = [];
    for (let i=Math.max(0,answer-10);i<=Math.min(100,answer+10);i++) pool.push(i);
    return qBase('number_id', {
      prompt:`Tap ${answer}.`, spoken:`Tap the number ${answer}.`, stimulus:'💯',
      choices:uniqueChoices(answer,pool), answer,
      feedback:`Correct. That is ${answer}.`, standard:'CA K.CC.1 / K.CC.3'
    });
  }

  function numberSequence() {
    const n = 5 + rand(91);
    const mode = sample(['after','before','missing']);
    if (mode==='after') return qBase('number_sequence', {
      prompt:`What comes after ${n}?`, spoken:`What number comes after ${n}?`, stimulus:`${n}, __`, stimulusType:'word',
      choices:uniqueChoices(n+1,[n-1,n,n+2,n+10]), answer:n+1, feedback:`Yes. ${n+1} comes after ${n}.`, standard:'CA K.CC.2'
    });
    if (mode==='before') return qBase('number_sequence', {
      prompt:`What comes before ${n}?`, spoken:`What number comes before ${n}?`, stimulus:`__, ${n}`, stimulusType:'word',
      choices:uniqueChoices(n-1,[n,n+1,n-2,Math.max(0,n-10)]), answer:n-1, feedback:`Yes. ${n-1} comes before ${n}.`, standard:'CA K.CC.2'
    });
    return qBase('number_sequence', {
      prompt:'Find the missing number.', spoken:'Find the missing number.', stimulus:`${n}, ${n+1}, __, ${n+3}`, stimulusType:'word',
      choices:uniqueChoices(n+2,[n-1,n+1,n+3,n+12]), answer:n+2, feedback:`Correct. The missing number is ${n+2}.`, standard:'CA K.CC.2'
    });
  }

  function compare() {
    const a = rand(21), b = rand(21);
    const relation = a===b ? 'equal to' : a>b ? 'greater than' : 'less than';
    const answer = relation;
    return qBase('compare', {
      prompt:`${a} is…`, spoken:`${a} is what, compared with ${b}?`, stimulus:`${a}  ?  ${b}`, stimulusType:'equation',
      choices:['greater than','less than','equal to'], answer,
      feedback:`Right. ${a} is ${relation} ${b}.`, standard:'CA K.CC.6 / K.CC.7', textChoices:true
    });
  }

  function teenNumbers() {
    const n = 11 + rand(9), ones=n-10;
    const answer = `10 + ${ones}`;
    const pool = [`1 + ${ones}`,`10 + ${Math.max(0,ones-1)}`,`10 + ${Math.min(9,ones+1)}`,`${ones} + ${ones}`];
    return qBase('teen_numbers', {
      prompt:`Build ${n} as one ten and some ones.`, spoken:`Which shows ${n} as one ten and extra ones?`,
      stimulus:`🔟 ${'•'.repeat(ones)}`, stimulusType:'objects', choices:uniqueChoices(answer,pool,4), answer,
      feedback:`Yes. ${n} is one ten and ${ones} ones.`, standard:'CA K.NBT.1', textChoices:true
    });
  }

  function addition(max, module) {
    const a = rand(max+1), b = rand(max-a+1), answer=a+b;
    const emoji = sample(['🚀','⭐','🤖','💎']);
    return qBase(module, {
      prompt:`How many altogether?`, spoken:`${a} plus ${b}. How many altogether?`,
      subprompt:`${a} plus ${b}`, stimulus:`${emoji.repeat(a)}  +  ${emoji.repeat(b)}`, stimulusType:'objects',
      choices:uniqueChoices(answer,[Math.max(0,answer-2),Math.max(0,answer-1),answer+1,answer+2,max]), answer,
      feedback:`Correct. ${a} plus ${b} equals ${answer}.`, standard:max===5?'CA K.OA.1 / K.OA.5':'CA K.OA.2 / K.OA.4'
    });
  }

  function subtraction5() {
    const a=1+rand(5), b=rand(a+1), answer=a-b;
    return qBase('subtraction5', {
      prompt:'How many ships remain?', spoken:`There are ${a} ships. ${b} fly away. How many remain?`,
      subprompt:`${a} take away ${b}`, stimulus:`${'🚀'.repeat(a)}  −  ${'🚀'.repeat(b)}`, stimulusType:'objects',
      choices:uniqueChoices(answer,[Math.max(0,answer-1),answer+1,a,b]), answer,
      feedback:`Yes. ${a} take away ${b} equals ${answer}.`, standard:'CA K.OA.1 / K.OA.5'
    });
  }

  function shapeQuestion() {
    const [name,emoji] = sample(SHAPES);
    return qBase('shapes', {
      prompt:'What shape is this?', spoken:'What shape is this?', stimulus:emoji,
      choices:uniqueChoices(name,SHAPES.map(x=>x[0])), answer:name,
      feedback:`Correct. It is a ${name}.`, standard:'CA K.G.2 / K.G.4', textChoices:true
    });
  }

  function generate(module, opts={}) {
    switch(module) {
      case 'counting_ladder': return countingLadder(opts.band ?? 0);
      case 'letter_id': return letterId();
      case 'initial_sound': return initialSound();
      case 'rhyme': return rhyme();
      case 'cvc_a': return cvc('a','cvc_a');
      case 'cvc_i': return cvc('i','cvc_i');
      case 'cvc_more': return cvc(sample(['o','u','e']),'cvc_more');
      case 'sight_words': return sightWord();
      case 'number_id': return numberId();
      case 'number_sequence': return numberSequence();
      case 'compare': return compare();
      case 'teen_numbers': return teenNumbers();
      case 'addition5': return addition(5,'addition5');
      case 'subtraction5': return subtraction5();
      case 'addition10': return addition(10,'addition10');
      case 'shapes': return shapeQuestion();
      default: return letterId();
    }
  }

  const placementPlan = ['letter_id','initial_sound','rhyme','cvc_a','sight_words','number_id','number_sequence','compare','teen_numbers','addition5','subtraction5','shapes'];

  return { MODULES, LETTERS, CVC, SIGHT_WORDS, BANDS, generate, placementPlan };
})();
