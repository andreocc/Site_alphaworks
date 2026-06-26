/* ============================================================
   MAIN.JS — AlphaWorks / André Occenstein
   Navegação, tema, scroll reveal, dados dinâmicos, graph 3D.
   ============================================================ */

/* ── THEME ────────────────────────────── */
const html = document.documentElement;
const themeToggle = document.getElementById('themeToggle');

function getPreferredTheme() {
  const stored = localStorage.getItem('aw-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme) {
  html.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#060708' : '#fafafb');
  localStorage.setItem('aw-theme', theme);
}

// Init theme from saved pref or system
const initialTheme = getPreferredTheme();
applyTheme(initialTheme);

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const current = html.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
}

// Listen for system theme changes (only if user hasn't set a preference)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (!localStorage.getItem('aw-theme')) {
    applyTheme(e.matches ? 'dark' : 'light');
  }
});

/* ── NAV: scroll state + progress ─────── */
const nav = document.getElementById('nav');
const navProgress = document.getElementById('navProgress');

function onNavScroll() {
  const scrolled = window.scrollY > 40;
  nav.classList.toggle('is-scrolled', scrolled);

  if (navProgress) {
    const docH = document.documentElement.scrollHeight - window.innerHeight;
    const pct = docH > 0 ? Math.min((window.scrollY / docH) * 100, 100) : 0;
    navProgress.style.width = `${pct}%`;
  }
}
window.addEventListener('scroll', onNavScroll, { passive: true });
onNavScroll();

/* ── NAV: active section tracking ─────── */
const navLinks = document.querySelectorAll('.nav__link[data-section]');
const sections = [...navLinks]
  .map(link => document.getElementById(link.dataset.section))
  .filter(Boolean);

const sectionObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      navLinks.forEach(link => {
        link.classList.toggle('is-active', link.dataset.section === entry.target.id);
      });
    }
  }
}, { threshold: 0.25, rootMargin: '-15% 0px -55% 0px' });

sections.forEach(s => sectionObserver.observe(s));

/* ── NAV: mobile menu ────────────────── */
const navInner = document.querySelector('.nav__inner');
const navLinksEl = document.getElementById('navLinks');

const menuToggle = document.createElement('button');
menuToggle.className = 'nav__toggle';
menuToggle.setAttribute('aria-label', 'Abrir menu');
menuToggle.setAttribute('aria-expanded', 'false');
menuToggle.innerHTML = '<span></span><span></span><span></span>';
navInner.insertBefore(menuToggle, themeToggle);

let menuOpen = false;
menuToggle.addEventListener('click', () => {
  menuOpen = !menuOpen;
  menuToggle.setAttribute('aria-expanded', String(menuOpen));
  menuToggle.setAttribute('aria-label', menuOpen ? 'Fechar menu' : 'Abrir menu');
  menuToggle.classList.toggle('is-open', menuOpen);
  navLinksEl.classList.toggle('is-open', menuOpen);
  document.body.style.overflow = menuOpen ? 'hidden' : '';
});

navLinksEl.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    menuOpen = false;
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Abrir menu');
    menuToggle.classList.remove('is-open');
    navLinksEl.classList.remove('is-open');
    document.body.style.overflow = '';
  });
});

/* ── SCROLL REVEAL ────────────────────── */
function setupReveal() {
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('is-revealed'));
    document.querySelectorAll('.reveal-stagger > *').forEach(el => el.classList.add('is-revealed'));
    return;
  }

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-revealed');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' });

  document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

  document.querySelectorAll('.reveal-stagger').forEach(container => {
    const staggerObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const idx = [...container.children].indexOf(entry.target);
          setTimeout(() => entry.target.classList.add('is-revealed'), idx * 55);
          staggerObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.06, rootMargin: '0px 0px -12px 0px' });

    [...container.children].forEach(child => staggerObserver.observe(child));
  });
}
setupReveal();

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ── RSS ──────────────────────────────── */
const RSS_CACHE_KEY = 'aw_blog_posts';
const RSS_CACHE_TTL = 30 * 60 * 1000;

async function fetchBlogPosts() {
  const container = document.getElementById('writingsList');
  if (!container) return;

  try {
    const cached = JSON.parse(sessionStorage.getItem(RSS_CACHE_KEY));
    if (cached?.timestamp && (Date.now() - cached.timestamp < RSS_CACHE_TTL)) {
      renderWritings(cached.data);
      return;
    }
  } catch (_) {}

  try {
    const res = await fetch('https://blog.alphaworks.com.br/index.xml');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const xmlText = await res.text();
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');

    if (doc.querySelector('parsererror')) throw new Error('XML parse error');

    const items = [...doc.querySelectorAll('item')].slice(0, 5).map(item => ({
      title: item.querySelector('title')?.textContent || '',
      link: item.querySelector('link')?.textContent || '',
      date: item.querySelector('pubDate')?.textContent || '',
    }));

    if (!items.length) throw new Error('Nenhum post encontrado');

    sessionStorage.setItem(RSS_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: items }));
    renderWritings(items);
  } catch (err) {
    console.warn('RSS indisponível:', err.message);
    renderWritingsFallback();
  }
}

function renderWritings(posts) {
  const container = document.getElementById('writingsList');
  if (!container) return;

  container.innerHTML = '';
  container.classList.add('reveal-stagger');

  posts.forEach(post => {
    const item = document.createElement('a');
    item.href = post.link;
    item.target = '_blank';
    item.rel = 'noopener noreferrer';
    item.className = 'writing-item';
    item.setAttribute('role', 'listitem');

    item.innerHTML = `
      <span class="writing-item__date">${fmtDate(post.date)}</span>
      <span class="writing-item__title">${esc(post.title)}</span>
    `;

    container.appendChild(item);
  });

  reObserveStagger(container);
}

function renderWritingsFallback() {
  const container = document.getElementById('writingsList');
  if (!container) return;
  container.innerHTML = `
    <div style="text-align:center;padding:var(--sp-10);color:var(--text-muted);font-size:.875rem;">
      <p>Posts indisponíveis no momento.</p>
      <a href="https://blog.alphaworks.com.br" target="_blank" rel="noopener noreferrer" style="color:var(--accent);">Ir para o blog →</a>
    </div>`;
}

function fmtDate(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr.slice(0, 11);
    return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })
      .replace('.', '');
  } catch (_) { return dateStr; }
}

/* ── STAGGER RE-OBSERVER ──────────────── */
function reObserveStagger(container) {
  if (!('IntersectionObserver' in window)) {
    [...container.children].forEach(ch => ch.classList.add('is-revealed'));
    return;
  }

  const staggerObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const idx = [...container.children].indexOf(entry.target);
        setTimeout(() => entry.target.classList.add('is-revealed'), idx * 55);
        staggerObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.06, rootMargin: '0px 0px -12px 0px' });

  [...container.children].forEach(child => staggerObserver.observe(child));
}

/* ── GRAPH 3D: lazy init ─────────────── */
let graphInitialized = false;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function initGraphWhenVisible() {
  const canvasWrap = document.getElementById('heroCanvas');
  if (!canvasWrap || graphInitialized) return;

  const graphObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !graphInitialized) {
      graphInitialized = true;
      graphObserver.disconnect();

      import('./graph.js')
        .then(mod => mod.initGraph(canvasWrap))
        .catch(err => console.warn('Graph 3D falhou ao carregar:', err.message));
    }
  }, { threshold: 0.03 });

  graphObserver.observe(canvasWrap);
}

/* ── INIT ─────────────────────────────── */
function init() {
  fetchBlogPosts();

  if (!prefersReducedMotion) {
    initGraphWhenVisible();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
