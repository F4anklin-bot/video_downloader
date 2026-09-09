const PLATFORMS = [
  { id: 'tiktok', name: 'TikTok', color: '#ff2d55', re: /tiktok\.com/i },
  { id: 'instagram', name: 'Instagram', color: '#e1306c', re: /instagram\.com|instagr\.am/i },
  { id: 'youtube', name: 'YouTube', color: '#ff0033', re: /youtube\.com|youtu\.be/i },
  { id: 'x', name: 'X', color: '#e7e9ea', re: /(?:x|twitter)\.com/i },
  { id: 'snapchat', name: 'Snapchat', color: '#fffc00', re: /snapchat\.com/i },
  { id: 'reddit', name: 'Reddit', color: '#ff4500', re: /reddit\.com|redd\.it/i },
  { id: 'facebook', name: 'Facebook', color: '#1877f2', re: /facebook\.com|fb\.watch/i },
  { id: 'vimeo', name: 'Vimeo', color: '#1ab7ea', re: /vimeo\.com/i },
  { id: 'dailymotion', name: 'Dailymotion', color: '#00beff', re: /dailymotion\.com|dai\.ly/i },
  { id: 'twitch', name: 'Twitch', color: '#bf94ff', re: /twitch\.tv/i },
];

const RING = 326.73;
const $ = (id) => document.getElementById(id);

const state = {
  info: null,
  sourceUrl: '',
  quality: localStorage.getItem('franklins-quality') || 'best',
  downloading: false,
  deferredPrompt: null,
  themePref: localStorage.getItem('franklins-theme') || 'dark',
  previewTimer: 0,
  logoHits: 0,
};

const QUOTES = [
  'Un lien, un souvenir.',
  'Moins de bruit. Plus de films.',
  'Franklin range, toi tu savourises.',
  'Le cloud, c’est bien. Ton dossier, c’est mieux.',
  'HD si tu veux. Rapide si tu fonces.',
  'Ça tient dans une poche. Et dans un PWA.',
];

function hourGreeting() {
  const h = new Date().getHours();
  if (h < 6) return 'Encore éveillé · dix plateformes';
  if (h < 12) return 'Bonjour · dix plateformes';
  if (h < 18) return 'Bon après-midi · dix plateformes';
  return 'Bonne soirée · dix plateformes';
}

function statsGet() {
  try {
    return JSON.parse(localStorage.getItem('franklins-stats') || '{"count":0,"seconds":0}');
  } catch {
    return { count: 0, seconds: 0 };
  }
}

function statsAdd(seconds) {
  const s = statsGet();
  s.count += 1;
  s.seconds += seconds || 0;
  localStorage.setItem('franklins-stats', JSON.stringify(s));
  renderStats();
}

function renderStats() {
  const s = statsGet();
  const badge = $('statBadge');
  const line = $('statsLine');
  if (!badge) return;
  badge.textContent = String(s.count);
  if (!s.count) {
    line.textContent = 'Encore rien — le premier est le plus beau.';
    return;
  }
  const min = Math.round(s.seconds / 60);
  line.textContent =
    s.count === 1
      ? '1 vidéo dans la session. Ça commence bien.'
      : `${s.count} vidéos · ${min ? min + ' min' : s.seconds + ' s'} de contenu.`;
}

function resolvedTheme(pref) {
  if (pref === 'auto') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return pref === 'light' ? 'light' : 'dark';
}

function applyTheme(pref, { animate = true } = {}) {
  state.themePref = pref;
  localStorage.setItem('franklins-theme', pref);
  const resolved = resolvedTheme(pref);
  const paint = () => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePref = pref;
    const meta = $('themeColor');
    if (meta) meta.setAttribute('content', resolved === 'light' ? '#f3efe6' : '#070708');
    document.querySelectorAll('#themePref button').forEach((b) => {
      b.classList.toggle('is-on', b.dataset.theme === pref);
    });
  };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (animate && !reduce && document.startViewTransition) {
    document.startViewTransition(paint);
  } else {
    paint();
  }
}

function cycleTheme() {
  const order = ['dark', 'light', 'auto'];
  const next = order[(order.indexOf(state.themePref) + 1) % order.length];
  applyTheme(next);
}

function burstConfetti() {
  const canvas = $('confetti');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const bits = [];
  const colors = ['#d4f04f', '#ff6b6b', '#7dffb3', '#7ab8ff', '#ffd166'];
  const w = (canvas.width = innerWidth);
  const h = (canvas.height = innerHeight);
  for (let i = 0; i < 90; i += 1) {
    bits.push({
      x: w / 2,
      y: h * 0.28,
      vx: (Math.random() - 0.5) * 14,
      vy: Math.random() * -11 - 4,
      s: Math.random() * 7 + 3,
      c: colors[i % colors.length],
      r: Math.random() * 6,
    });
  }
  let frames = 0;
  const tick = () => {
    frames += 1;
    ctx.clearRect(0, 0, w, h);
    bits.forEach((b) => {
      b.vy += 0.28;
      b.x += b.vx;
      b.y += b.vy;
      b.r += 0.12;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.r);
      ctx.fillStyle = b.c;
      ctx.fillRect(-b.s / 2, -b.s / 2, b.s, b.s * 0.6);
      ctx.restore();
    });
    if (frames < 90) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, w, h);
  };
  tick();
}

function detect(text) {
  const found = String(text || '').match(/https?:\/\/[^\s]+/i)?.[0] || text;
  const p = PLATFORMS.find((x) => x.re.test(found));
  return { platform: p || null, url: found };
}

function toast(message, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 280);
  }, 2800);
}

function formatDuration(s) {
  const n = Number(s) || 0;
  if (!n) return '';
  const m = Math.floor(n / 60);
  const r = Math.floor(n % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

function formatBytes(n) {
  if (!n) return '0 o';
  const u = ['o', 'Ko', 'Mo', 'Go'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function historyGet() {
  try {
    return JSON.parse(sessionStorage.getItem('franklins-history') || '[]');
  } catch {
    return [];
  }
}

function historyPush(item) {
  const list = [item, ...historyGet().filter((x) => x.sourceUrl !== item.sourceUrl)].slice(0, 24);
  sessionStorage.setItem('franklins-history', JSON.stringify(list));
  renderHistory();
}

function setTab(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === id));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === id));
  $('peek').classList.toggle('is-away', id !== 'home');
  if (id !== 'home') stopPreview();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function renderPlatforms() {
  $('platforms').innerHTML = PLATFORMS.map(
    (p, i) => `<li style="--p:${p.color};animation-delay:${i * 40}ms"><i></i>${p.name}</li>`,
  ).join('');
}

function updateChip(value) {
  const { platform } = detect(value);
  const chip = $('platformChip');
  const clear = $('clearBtn');
  clear.hidden = !value;
  if (!platform) {
    chip.hidden = true;
    return;
  }
  chip.hidden = false;
  chip.style.setProperty('--p', platform.color);
  chip.textContent = platform.name;
}

function setAnalyzing(on) {
  $('analyzeBtn').disabled = on;
  $('analyzeBtn').querySelector('.btn-label').textContent = on ? 'Analyse…' : 'Analyser';
  $('analyzeBtn').querySelector('.btn-spinner').hidden = !on;
}

function qualityButtons(info) {
  const presets = [
    { id: 'best', label: 'Auto' },
    { id: 'hd', label: 'HD' },
    { id: 'fast', label: 'Rapide' },
    { id: 'sd', label: 'SD' },
  ];
  return presets
    .map(
      (q) =>
        `<button type="button" data-q="${q.id}" class="${state.quality === q.id ? 'is-on' : ''}">${q.label}</button>`,
    )
    .join('');
}

function renderPreview(info) {
  const platform = PLATFORMS.find((p) => p.id === info.platform) || { name: 'Vidéo', color: '#d4f04f' };
  $('thumb').src = info.thumbnail || '';
  $('thumb').alt = info.title;
  $('title').textContent = info.title;
  $('author').textContent = `@${String(info.author || '').replace(/^@/, '')}`;
  $('duration').textContent = formatDuration(info.duration);
  $('duration').hidden = !info.duration;
  $('qualityTag').textContent = info.quality || 'Auto';
  const chip = $('resultChip');
  chip.style.setProperty('--p', platform.color);
  chip.textContent = platform.name;
  $('qualityRow').innerHTML = qualityButtons(info);
  $('result').hidden = false;
  $('peek').classList.add('has-result');
  resetDownloadUi();
  stopPreview();
  if (window.matchMedia('(max-width: 1179px)').matches) {
    requestAnimationFrame(() => {
      const top = $('peek').getBoundingClientRect().top + window.scrollY - 12;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  }
}

function resetDownloadUi() {
  const btn = $('downloadBtn');
  btn.disabled = false;
  btn.querySelector('.dl-idle').hidden = false;
  btn.querySelector('.dl-progress').hidden = true;
  btn.querySelector('.dl-done').hidden = true;
  $('transfer').hidden = true;
  $('transfer').classList.remove('is-indet');
}

function applyProgress(loaded, total, speed) {
  const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : null;
  const offset = pct == null ? RING * 0.35 : RING * (1 - pct / 100);
  $('ringFg').style.strokeDashoffset = String(offset);
  $('dlPercent').textContent = pct == null ? '…' : `${pct}%`;
  $('transferFill').style.width = `${pct == null ? 32 : pct}%`;
  $('transfer').hidden = false;
  $('transfer').classList.toggle('is-indet', pct == null);
  $('transferSize').textContent = total ? `${formatBytes(loaded)} / ${formatBytes(total)}` : formatBytes(loaded);
  $('transferSpeed').textContent = speed ? `${formatBytes(speed)}/s` : '';
}

function markDownloading() {
  const btn = $('downloadBtn');
  btn.disabled = true;
  btn.querySelector('.dl-idle').hidden = true;
  btn.querySelector('.dl-progress').hidden = false;
  btn.querySelector('.dl-done').hidden = true;
}

function markDone() {
  const btn = $('downloadBtn');
  btn.disabled = false;
  btn.querySelector('.dl-idle').hidden = true;
  btn.querySelector('.dl-progress').hidden = true;
  btn.querySelector('.dl-done').hidden = false;
  $('ringFg').style.strokeDashoffset = '0';
  $('transferFill').style.width = '100%';
  if (navigator.vibrate) navigator.vibrate([12, 40, 18]);
  burstConfetti();
  statsAdd(infoDuration());
  if (statsGet().count === 5) toast('Cinq d’un coup. Franklin applaudit.');
  setTimeout(resetDownloadUi, 1800);
}

async function analyze(url) {
  const detected = detect(url);
  const clean = detected.url && /^https?:\/\//i.test(detected.url) ? detected.url : url;
  if (!clean || !/^https?:\/\//i.test(clean)) {
    toast('Collez un lien valide.', 'error');
    return;
  }
  state.sourceUrl = clean;
  stopPreview();
  setAnalyzing(true);
  try {
    const res = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: clean, quality: state.quality }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Analyse impossible');
    state.info = data;
    renderPreview(data);
    toast(`${data.platform} · prêt`);
  } catch (err) {
    toast(err.message || 'Analyse impossible', 'error');
  } finally {
    setAnalyzing(false);
  }
}

function infoDuration() {
  return Number(state.info?.duration) || 0;
}

function embedSrc(platform, url) {
  const u = String(url || '');
  if (platform === 'youtube') {
    const id = u.match(/[?&]v=([^&]+)/)?.[1] || u.match(/youtu\.be\/([^?&/]+)/)?.[1];
    if (id) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&modestbranding=1`;
  }
  if (platform === 'vimeo') {
    const id = u.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1];
    if (id) return `https://player.vimeo.com/video/${id}?autoplay=1`;
  }
  if (platform === 'dailymotion') {
    const id = u.match(/(?:video|dai\.ly)\/([a-zA-Z0-9]+)/)?.[1];
    if (id) return `https://www.dailymotion.com/embed/video/${id}?autoplay=1`;
  }
  return null;
}

function stopPreview() {
  const wrap = $('thumbWrap');
  const video = $('previewVideo');
  const frame = $('previewFrame');
  const wait = $('previewWait');
  if (state.previewTimer) {
    clearTimeout(state.previewTimer);
    state.previewTimer = 0;
  }
  if (!wrap || !video) return;
  wrap.classList.remove('is-playing', 'is-loading', 'is-embed');
  if (wait) wait.hidden = true;
  video.pause();
  video.removeAttribute('src');
  video.load();
  if (frame) {
    frame.hidden = true;
    frame.removeAttribute('src');
  }
  const play = $('previewPlay');
  if (play) {
    play.querySelector('.icon-play').hidden = false;
    play.querySelector('.icon-pause').hidden = true;
    play.setAttribute('aria-label', 'Lire l’aperçu');
  }
}

function startPreview() {
  if (!state.info || !state.sourceUrl) return;
  const wrap = $('thumbWrap');
  const video = $('previewVideo');
  const frame = $('previewFrame');
  const wait = $('previewWait');
  const embed = embedSrc(state.info.platform, state.sourceUrl);

  if (wrap.classList.contains('is-loading')) {
    stopPreview();
    return;
  }

  if (wrap.classList.contains('is-playing')) {
    if (embed) {
      stopPreview();
      return;
    }
    if (!video.paused) {
      video.pause();
      return;
    }
    video.play().catch(() => {});
    return;
  }

  stopPreview();
  wrap.classList.add('is-loading');
  wait.hidden = false;

  if (embed) {
    wrap.classList.add('is-playing', 'is-embed');
    wait.hidden = true;
    wrap.classList.remove('is-loading');
    frame.hidden = false;
    frame.src = embed;
    return;
  }

  const src = state.info.previewUrl || `/api/file?url=${encodeURIComponent(state.sourceUrl)}&quality=fast&inline=1`;
  video.controls = true;
  video.src = src;
  state.previewTimer = window.setTimeout(() => {
    if (wrap.classList.contains('is-loading')) {
      toast('Aperçu trop long à charger', 'error');
      stopPreview();
    }
  }, 25000);
  const play = video.play();
  if (play && typeof play.then === 'function') {
    play.catch(() => {
      toast('Aperçu indisponible pour cette vidéo', 'error');
      stopPreview();
    });
  }
}

function downloadCurrent() {
  if (!state.info || state.downloading) return;
  stopPreview();
  const info = state.info;
  const url = `/api/file?url=${encodeURIComponent(state.sourceUrl)}&quality=${encodeURIComponent(state.quality)}`;
  state.downloading = true;
  markDownloading();
  applyProgress(0, 0, 0);
  $('dlPercent').textContent = '…';

  const xhr = new XMLHttpRequest();
  xhr.open('GET', url);
  xhr.responseType = 'blob';
  xhr.timeout = 0;
  let lastLoaded = 0;
  let lastAt = Date.now();
  let speed = 0;

  xhr.onprogress = (e) => {
    const now = Date.now();
    const dt = (now - lastAt) / 1000;
    if (dt >= 0.2) {
      speed = (e.loaded - lastLoaded) / dt;
      lastLoaded = e.loaded;
      lastAt = now;
    }
    const total = e.lengthComputable ? e.total : info.filesize || 0;
    applyProgress(e.loaded, total, speed);
  };

  xhr.onload = async () => {
    state.downloading = false;
    const blob = xhr.response;
    if (xhr.status < 200 || xhr.status >= 300) {
      let message = 'Téléchargement impossible';
      try {
        const text = await blob.text();
        message = JSON.parse(text).message || message;
      } catch {
        /* keep */
      }
      resetDownloadUi();
      toast(message, 'error');
      return;
    }
    if (blob.type && blob.type.includes('json')) {
      try {
        const message = JSON.parse(await blob.text()).message;
        resetDownloadUi();
        toast(message || 'Téléchargement impossible', 'error');
        return;
      } catch {
        /* fallthrough */
      }
    }
    const name = decodeURIComponent(xhr.getResponseHeader('X-Filename') || info.filename || 'video.mp4');
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
    markDone();
    historyPush({
      title: info.title,
      author: info.author,
      thumbnail: info.thumbnail,
      platform: info.platform,
      sourceUrl: state.sourceUrl,
      filename: name,
      at: Date.now(),
    });
    toast('Fichier enregistré');
  };

  xhr.onerror = () => {
    state.downloading = false;
    resetDownloadUi();
    toast('Connexion interrompue', 'error');
  };
  xhr.send();
}

function renderHistory() {
  const list = historyGet();
  const root = $('historyList');
  if (!list.length) {
    root.innerHTML = '<p class="history-empty">Aucun téléchargement pour cette session.</p>';
    return;
  }
  root.innerHTML = list
    .map((item, i) => {
      const p = PLATFORMS.find((x) => x.id === item.platform);
      return `<button class="hist-item" data-url="${encodeURIComponent(item.sourceUrl)}" style="animation-delay:${i * 40}ms">
        ${item.thumbnail ? `<img src="${item.thumbnail}" alt="" referrerpolicy="no-referrer">` : '<div class="hist-ph"></div>'}
        <div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${p ? p.name : item.platform} · @${escapeHtml(String(item.author || '').replace(/^@/, ''))}</p>
        </div>
        <span class="mini">Ouvrir</span>
      </button>`;
    })
    .join('');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bindQualityDefault() {
  document.querySelectorAll('#defaultQuality button').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.q === state.quality);
  });
}

function maybeInstallVisible() {
  $('installBtn').hidden = !state.deferredPrompt;
}

async function promptInstall() {
  if (state.deferredPrompt) {
    state.deferredPrompt.prompt();
    await state.deferredPrompt.userChoice;
    state.deferredPrompt = null;
    maybeInstallVisible();
    return;
  }
  toast('Sur iPhone : Partager → Sur l’écran d’accueil');
}

function wire() {
  renderPlatforms();
  renderHistory();
  bindQualityDefault();
  applyTheme(state.themePref, { animate: false });
  renderStats();
  $('greeting').textContent = hourGreeting();

  $('composer').addEventListener('submit', (e) => {
    e.preventDefault();
    analyze($('url').value.trim());
  });

  $('url').addEventListener('input', (e) => updateChip(e.target.value));
  $('url').addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    setTimeout(() => {
      updateChip($('url').value);
      if (/https?:\/\//i.test(text)) analyze(text);
    }, 0);
  });

  $('pasteBtn').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      $('url').value = text.trim();
      updateChip(text);
      if (/https?:\/\//i.test(text)) analyze(text);
    } catch {
      toast('Autorisez le presse-papiers', 'error');
    }
  });

  $('clearBtn').addEventListener('click', () => {
    $('url').value = '';
    updateChip('');
    $('url').focus();
  });

  document.body.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) setTab(tab.dataset.tab);

    const q = e.target.closest('[data-q]');
    if (q && q.closest('#qualityRow')) {
      state.quality = q.dataset.q;
      document.querySelectorAll('#qualityRow button').forEach((b) => {
        b.classList.toggle('is-on', b.dataset.q === state.quality);
      });
    }
    if (q && q.closest('#defaultQuality')) {
      state.quality = q.dataset.q;
      localStorage.setItem('franklins-quality', state.quality);
      bindQualityDefault();
    }

    const th = e.target.closest('#themePref [data-theme]');
    if (th) applyTheme(th.dataset.theme);

    if (e.target.closest('#downloadBtn')) downloadCurrent();

    const hist = e.target.closest('.hist-item');
    if (hist) {
      const url = decodeURIComponent(hist.dataset.url);
      $('url').value = url;
      updateChip(url);
      setTab('home');
      analyze(url);
    }
  });

  $('previewPlay').addEventListener('click', startPreview);

  const previewVideo = $('previewVideo');
  previewVideo.addEventListener('playing', () => {
    const wrap = $('thumbWrap');
    wrap.classList.add('is-playing');
    wrap.classList.remove('is-loading');
    $('previewWait').hidden = true;
    if (state.previewTimer) {
      clearTimeout(state.previewTimer);
      state.previewTimer = 0;
    }
  });
  previewVideo.addEventListener('pause', () => {
    if (previewVideo.ended) return;
    $('previewPlay').querySelector('.icon-play').hidden = false;
    $('previewPlay').querySelector('.icon-pause').hidden = true;
  });
  previewVideo.addEventListener('ended', stopPreview);
  previewVideo.addEventListener('error', () => {
    if (!previewVideo.src) return;
    toast('Aperçu indisponible pour cette vidéo', 'error');
    stopPreview();
  });

  $('copyLinkBtn').addEventListener('click', async () => {
    if (!state.sourceUrl) return;
    try {
      await navigator.clipboard.writeText(state.sourceUrl);
      toast('Lien copié');
    } catch {
      toast('Impossible de copier', 'error');
    }
  });

  $('luckyBtn').addEventListener('click', () => {
    toast(QUOTES[Math.floor(Math.random() * QUOTES.length)]);
  });

  $('themeBtn').addEventListener('click', cycleTheme);

  document.querySelector('.brand').addEventListener('click', (e) => {
    e.preventDefault();
    state.logoHits += 1;
    if (state.logoHits >= 5) {
      state.logoHits = 0;
      document.documentElement.classList.toggle('party');
      burstConfetti();
      toast(document.documentElement.classList.contains('party') ? 'Mode Franklin activé' : 'Retour au calme');
    }
  });

  $('clearHistory').addEventListener('click', () => {
    sessionStorage.removeItem('franklins-history');
    renderHistory();
    toast('Historique vidé');
  });

  $('installBtn').addEventListener('click', promptInstall);
  $('installBtn2').addEventListener('click', promptInstall);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredPrompt = e;
    maybeInstallVisible();
  });

  const dz = $('dropzone');
  const hint = $('dropHint');
  const onDrag = (e) => {
    e.preventDefault();
    dz.classList.add('is-drop');
    hint.classList.add('is-on');
    hint.textContent = 'Relâchez le lien';
  };
  const offDrag = () => {
    dz.classList.remove('is-drop');
    hint.classList.remove('is-on');
    hint.textContent = 'Déposez un lien n’importe où';
  };
  ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, onDrag));
  ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => {
    if (ev === 'drop') {
      e.preventDefault();
      const text = e.dataTransfer.getData('text') || e.dataTransfer.getData('url');
      if (text) {
        $('url').value = text.trim();
        updateChip(text);
        analyze(text);
      }
    }
    offDrag();
  }));

  const params = new URLSearchParams(location.search);
  const shared = params.get('url') || params.get('text') || params.get('title');
  if (shared && /https?:\/\//i.test(shared)) {
    const link = shared.match(/https?:\/\/[^\s]+/i)[0];
    $('url').value = link;
    updateChip(link);
    analyze(link);
  }

  window.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      analyze($('url').value.trim());
    }
    if (!typing && e.key === 'd') downloadCurrent();
    if (!typing && (e.key === 't' || e.key === 'T')) cycleTheme();
    if (!typing && e.key === '?') {
      toast('Entrée analyse · D télécharge · T thème · logo ×5');
    }
  });

  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (state.themePref === 'auto') applyTheme('auto');
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  const boot = $('boot');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.setTimeout(() => {
    boot.classList.add('is-done');
    document.documentElement.classList.remove('booting');
    boot.setAttribute('aria-hidden', 'true');
  }, reduce ? 180 : 2100);
}

wire();
