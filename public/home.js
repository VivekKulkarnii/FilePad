/* home.js – Homepage logic */

const slugInput = document.getElementById('slugInput');
const urlForm   = document.getElementById('urlForm');
const urlHint   = document.getElementById('urlHint');
const urlPrefix = document.getElementById('urlPrefix');
const randomBtn = document.getElementById('randomBtn');

// Update prefix to real host
urlPrefix.textContent = location.host + '/';

const SLUG_RE = /^[a-z0-9][a-z0-9\-_]{0,63}$/i;

function validate(val) {
  if (!val) return null;
  if (!SLUG_RE.test(val)) return 'Only letters, numbers, hyphens and underscores. Must start with a letter or number.';
  return null;
}

slugInput.addEventListener('input', () => {
  const err = validate(slugInput.value.trim());
  if (err) {
    urlHint.textContent = err;
    urlHint.classList.add('error');
  } else {
    urlHint.textContent = 'Only lowercase letters, numbers, hyphens and underscores.';
    urlHint.classList.remove('error');
  }
});

urlForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const slug = slugInput.value.trim();
  const err = validate(slug);
  if (err || !slug) {
    urlHint.textContent = err || 'Please enter a URL name.';
    urlHint.classList.add('error');
    slugInput.focus();
    return;
  }
  window.location.href = '/' + encodeURIComponent(slug);
});

// Adjectives + nouns for random name
const adj  = ['bright','swift','calm','bold','sharp','golden','silver','azure','cosmic','neon','silent','wild'];
const noun = ['panda','falcon','river','forest','storm','pixel','comet','ember','vault','summit','beam','echo'];

randomBtn.addEventListener('click', () => {
  const a = adj[Math.floor(Math.random() * adj.length)];
  const n = noun[Math.floor(Math.random() * noun.length)];
  const num = Math.floor(Math.random() * 900) + 100;
  slugInput.value = `${a}-${n}-${num}`;
  slugInput.dispatchEvent(new Event('input'));
  slugInput.focus();
});

// Navbar scroll effect
const navbar = document.getElementById('navbar');
if (navbar) {
  window.addEventListener('scroll', () => {
    if (window.scrollY > 20) {
      navbar.classList.add('navbar-scrolled');
    } else {
      navbar.classList.remove('navbar-scrolled');
    }
  });
}

// Nav URL Form logic
const navUrlForm    = document.getElementById('navUrlForm');
const navSlugInput  = document.getElementById('navSlugInput');
const navUrlPrefix  = document.getElementById('navUrlPrefix');

if (navUrlPrefix) {
  navUrlPrefix.textContent = location.host + '/';
}

if (navUrlForm && navSlugInput) {
  navUrlForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const slug = navSlugInput.value.trim();
    const err = validate(slug);
    if (!slug || err) {
      navSlugInput.focus();
      return;
    }
    window.location.href = '/' + encodeURIComponent(slug);
  });
}
