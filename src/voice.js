window.ShadowVoice = (() => {
  const STORAGE_KEY = 'romanShadowVoiceSettingsV1';
  const audioCache = new Map();
  let currentAudio = null;
  let voices = [];

  const defaults = {
    mode: 'device',
    deviceVoice: '',
    premiumEndpoint: '/api/speech',
    rate: 0.92,
    pitch: 1.04,
    enabled: true
  };

  function getSettings() {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
    catch { return { ...defaults }; }
  }

  function saveSettings(next) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...getSettings(), ...next }));
  }

  function refreshVoices() {
    if (!('speechSynthesis' in window)) return [];
    voices = window.speechSynthesis.getVoices() || [];
    return voices;
  }

  // Rank every available voice by how human it sounds.
  // Enhanced / Premium / Natural / Neural variants are dramatically warmer
  // than the plain defaults, and most devices ship them unused.
  function voiceQualityScore(v) {
    if (!/^en/i.test(v.lang)) return -1;
    const n = v.name.toLowerCase();
    let score = 0;
    if (/premium/.test(n)) score += 120;
    if (/enhanced/.test(n)) score += 110;
    if (/natural|neural/.test(n)) score += 100;
    if (/online/.test(n)) score += 80;                 // Microsoft cloud voices
    if (/siri/.test(n)) score += 90;
    if (/google/.test(n)) score += 60;                 // Chrome's Google voices beat local basics
    const favorites = ['ava','samantha','zoe','allison','susan','joelle','aria','jenny','karen','moira','serena'];
    if (favorites.some(f => n.includes(f))) score += 40;
    if (/^en-US/i.test(v.lang)) score += 15;
    if (/compact/.test(n)) score -= 60;                // compact = tinny
    if (/fred|albert|bad news|bells|boing|bubbles|cellos|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|kathy|ralph/.test(n)) score -= 200; // novelty voices
    return score;
  }

  function preferredVoice() {
    refreshVoices();
    const settings = getSettings();
    if (settings.deviceVoice) {
      const selected = voices.find(v => v.name === settings.deviceVoice);
      if (selected) return selected;
    }
    const ranked = voices
      .map(v => ({ v, score: voiceQualityScore(v) }))
      .filter(x => x.score >= 0)
      .sort((a, b) => b.score - a.score);
    return ranked[0]?.v || voices.find(v => /^en/i.test(v.lang)) || voices[0] || null;
  }

  function stop() {
    try { window.speechSynthesis?.cancel(); } catch {}
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
  }

  function speakDevice(text, options={}) {
    return new Promise(resolve => {
      if (!('speechSynthesis' in window)) return resolve(false);
      stop();
      const settings = getSettings();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = options.slow ? Math.max(.68, Number(settings.rate)-.1) : Number(settings.rate);
      utterance.pitch = Number(settings.pitch);
      utterance.volume = 1;
      const voice = preferredVoice();
      if (voice) utterance.voice = voice;
      let settled = false;
      const settle = ok => { if (!settled) { settled = true; clearTimeout(guard); resolve(ok); } };
      // Safety guard: some browsers never fire onend. Estimate the speech
      // length from the word count so the game can never freeze waiting.
      const words = String(text).trim().split(/\s+/).length;
      const guard = setTimeout(() => settle(true), Math.max(3000, words * 480 + 1500));
      utterance.onend = () => settle(true);
      utterance.onerror = () => settle(false);
      window.speechSynthesis.speak(utterance);
    });
  }

  async function speakPremium(text, options={}) {
    const settings = getSettings();
    const endpoint = settings.premiumEndpoint || '/api/speech';
    const cacheKey = `${options.style || 'teacher'}::${text}`;
    stop();
    try {
      let url = audioCache.get(cacheKey);
      if (!url) {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({
            text,
            style: options.style || 'warm-kindergarten-teacher',
            cacheKey
          })
        });
        if (!response.ok) throw new Error(`Voice server returned ${response.status}`);
        const blob = await response.blob();
        url = URL.createObjectURL(blob);
        audioCache.set(cacheKey, url);
      }
      currentAudio = new Audio(url);
      currentAudio.preload = 'auto';
      currentAudio.playbackRate = options.slow ? .92 : 1;
      await currentAudio.play();
      return await new Promise(resolve => {
        currentAudio.onended = () => { currentAudio = null; resolve(true); };
        currentAudio.onerror = () => { currentAudio = null; resolve(false); };
      });
    } catch (error) {
      console.warn('Premium voice unavailable; falling back to the device voice.', error);
      return speakDevice(text, options);
    }
  }

  async function speak(text, options={}) {
    const settings = getSettings();
    if (!settings.enabled || !text) return false;
    if (settings.mode === 'premium' && location.protocol !== 'file:') return speakPremium(text, options);
    return speakDevice(text, options);
  }

  function getVoiceOptions() {
    return refreshVoices().filter(v => /^en/i.test(v.lang)).sort((a,b)=>a.name.localeCompare(b.name));
  }

  if ('speechSynthesis' in window) {
    refreshVoices();
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  }

  return { speak, stop, getSettings, saveSettings, getVoiceOptions, refreshVoices };
})();
