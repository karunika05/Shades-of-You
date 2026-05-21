/* =====================================================
   SHADES OF YOU — script.js
   SPA navigation, cart, shop, forms, quiz, auth, AI chat
   ===================================================== */

/* Google Gemini — https://aistudio.google.com/apikey */
const GEMINI_API_KEY_DEFAULT = '';
const GEMINI_API_KEY_STORAGE = 'soy_gemini_api_key';
const GEMINI_MODEL_CACHE_KEY = 'soy_gemini_working_model';
/** Try in order — no deprecated IDs like gemini-1.5-flash-latest */
const GEMINI_PREFERRED_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash-8b',
  'gemini-1.5-flash',
  'gemini-1.5-pro'
];
const CHAT_HISTORY_LIMIT = 24;

const USERS_KEY = 'soy_users';
const SESSION_KEY = 'soy_session';
const REMEMBER_EMAIL_KEY = 'soy_remember_email';
const ORDERS_GUEST_KEY = 'soy_orders_guest';

/** Read/write storage — localStorage first, sessionStorage fallback (e.g. strict file mode) */
function storageGet(key) {
  try {
    var v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch (e) {
    console.warn('localStorage read failed', e);
  }
  try {
    return sessionStorage.getItem(key);
  } catch (e2) {
    return null;
  }
}

function storageSet(key, value) {
  var ok = false;
  try {
    localStorage.setItem(key, value);
    ok = true;
  } catch (e) {
    console.warn('localStorage write failed', e);
  }
  try {
    sessionStorage.setItem(key, value);
    ok = true;
  } catch (e2) {
    console.warn('sessionStorage write failed', e2);
  }
  return ok;
}

function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) {}
  try {
    sessionStorage.removeItem(key);
  } catch (e2) {}
}

const QUIZ_SYSTEM_PROMPT =
  'You are a dermatology-trained skincare advisor for Shades of You, an Indian clean beauty brand. Based on quiz answers, give a warm, specific 3-sentence personalised skin analysis, then recommend a simple morning + evening routine using these products only: Petal Rose Toner, Radiance Glow Serum, Silk SPF Shield, Velvet Moisturiser, Bakuchiol Night Serum, Watermelon Scrub, AHA Glow Toner, Barrier Repair Cream. Be concise and encouraging.';

const CHAT_SYSTEM_PROMPT =
  'You are Sage, the expert AI skincare assistant for Shades of You — an Indian clean beauty brand for Indian skin and climate. ' +
  'Answer every question naturally using full context from the conversation — never rely on keyword matching. ' +
  'You can discuss: skin types, routines (AM/PM), ingredients (niacinamide, bakuchiol, SPF, etc.), product comparisons, acne, pigmentation, sensitivity, pregnancy-safe options, order help, shipping, returns, and free dermatology consultations. ' +
  'Be warm, accurate, and concise (2–4 sentences unless the user asks for detail). ' +
  'Shop products (INR): Petal Rose Toner ₹1,800 | Radiance Glow Serum ₹2,800 | Silk SPF Shield ₹2,400 | Velvet ₹3,200 | Cloud Dew Night Cream ₹3,500 | Bakuchiol Night Serum ₹3,500 | Watermelon Scrub ₹2,200 | Centella Toning Toner ₹2,800 | Bio Collagen Deep Mask ₹2,400. ' +
  'Free shipping above ₹2,500 · 3–5 day delivery India-wide · 15-day returns · Free consult on the Consult page · Skin Quiz on site · Orders visible under profile My Orders after checkout. ' +
  'If unsure about medical diagnosis, suggest a free consult — do not prescribe medication.';

function getGeminiApiKey() {
  var stored = storageGet(GEMINI_API_KEY_STORAGE);
  if (stored && stored.trim().length > 10) return stored.trim();
  if (GEMINI_API_KEY_DEFAULT && GEMINI_API_KEY_DEFAULT.indexOf('Add your') === -1) {
    return GEMINI_API_KEY_DEFAULT.trim();
  }
  return '';
}

function isGeminiConfigured() {
  var key = getGeminiApiKey();
  return key.length > 10 && key.indexOf('YOUR_') !== 0;
}

function isModelNotFoundError(msg) {
  if (!msg) return false;
  return msg.indexOf('not found') !== -1 || msg.indexOf('NOT_FOUND') !== -1 || msg.indexOf('is not supported') !== -1;
}

/** Ask Google which models this API key can use for generateContent */
async function fetchAvailableGeminiModels() {
  var apiKey = getGeminiApiKey();
  if (!apiKey) return [];

  var res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(apiKey)
  );
  var data = await res.json();
  if (!res.ok || data.error) {
    throw new Error((data.error && data.error.message) || 'Could not list models');
  }

  return (data.models || [])
    .filter(function (m) {
      return m.supportedGenerationMethods && m.supportedGenerationMethods.indexOf('generateContent') !== -1;
    })
    .map(function (m) {
      return (m.name || '').replace(/^models\//, '');
    });
}

async function resolveGeminiModels() {
  var cached = storageGet(GEMINI_MODEL_CACHE_KEY);
  var ordered = [];

  if (cached) ordered.push(cached);

  try {
    var available = await fetchAvailableGeminiModels();
    GEMINI_PREFERRED_MODELS.forEach(function (id) {
      if (available.indexOf(id) !== -1 && ordered.indexOf(id) === -1) ordered.push(id);
    });
    available.forEach(function (id) {
      if (id.indexOf('flash') !== -1 && ordered.indexOf(id) === -1) ordered.push(id);
    });
  } catch (e) {
    console.warn('ListModels skipped:', e.message);
    GEMINI_PREFERRED_MODELS.forEach(function (id) {
      if (ordered.indexOf(id) === -1) ordered.push(id);
    });
  }

  if (!ordered.length) ordered = GEMINI_PREFERRED_MODELS.slice();
  return ordered;
}

async function callGeminiModel(model, systemPrompt, messages) {
  var apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error('Gemini API key not configured');

  var url =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    model +
    ':generateContent?key=' +
    encodeURIComponent(apiKey);

  var contents = messages.map(function (m) {
    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content) }]
    };
  });

  if (!contents.length) {
    contents = [{ role: 'user', parts: [{ text: 'Hello' }] }];
  }

  var res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: contents,
      generationConfig: { maxOutputTokens: 1000, temperature: 0.7 }
    })
  });

  var data = await res.json();

  if (!res.ok || data.error) {
    var errMsg = (data.error && data.error.message) || 'API request failed (' + res.status + ')';
    if (isModelNotFoundError(errMsg)) storageRemove(GEMINI_MODEL_CACHE_KEY);
    throw new Error(errMsg);
  }

  var candidate = data.candidates && data.candidates[0];
  if (!candidate || !candidate.content || !candidate.content.parts || !candidate.content.parts[0]) {
    var blockReason =
      candidate && candidate.finishReason ? ' (' + candidate.finishReason + ')' : '';
    throw new Error('No response from model' + blockReason);
  }

  storageSet(GEMINI_MODEL_CACHE_KEY, model);
  return candidate.content.parts[0].text.trim();
}

async function callGemini(systemPrompt, messages) {
  var models = await resolveGeminiModels();
  var lastErr;
  var tried = [];

  for (var i = 0; i < models.length; i++) {
    if (tried.indexOf(models[i]) !== -1) continue;
    tried.push(models[i]);
    try {
      return await callGeminiModel(models[i], systemPrompt, messages);
    } catch (e) {
      lastErr = e;
      console.warn('Gemini try failed:', models[i], e.message);
      if (!isModelNotFoundError(e.message)) break;
    }
  }

  throw lastErr || new Error('All Gemini models failed — check your API key at aistudio.google.com/apikey');
}

const PRODUCTS = [
  { name: 'Petal Rose Toner', price: 1800, cat: ['oily', 'combination', 'sensitive', 'redness'], sku: 'toner' },
  { name: 'Radiance Glow Serum', price: 2800, cat: ['dullness', 'pigmentation', 'normal', 'combination'], sku: 'serum' },
  { name: 'Silk SPF Shield', price: 2200, cat: ['oily', 'combination', 'acne', 'normal'], sku: 'spf' },
  { name: 'Velvet Moisturiser', price: 2500, cat: ['dry', 'normal', 'sensitive'], sku: 'moisturiser' },
  { name: 'Bakuchiol Night Serum', price: 3200, cat: ['aging', 'dry', 'pigmentation'], sku: 'night-serum' },
  { name: 'Watermelon Scrub', price: 1900, cat: ['oily', 'combination', 'dullness'], sku: 'scrub' },
  { name: 'AHA Glow Toner', price: 2100, cat: ['acne', 'oily', 'dullness', 'pigmentation'], sku: 'aha-toner' },
  { name: 'Barrier Repair Cream', price: 2400, cat: ['sensitive', 'dry', 'redness'], sku: 'barrier' }
];

var cart = [];
var quizAnswers = {};
var chatHistory = [];
var currentSpread = 1;
var totalSpreads = 4;
var isFlipping = false;
var revealObserver = null;

/* ── LOADER ── */
window.addEventListener('load', function () {
  setTimeout(function () {
    document.getElementById('loader').classList.add('hidden');
  }, 1200);
});

/* ── NAVBAR SCROLL ── */
window.addEventListener('scroll', function () {
  var nav = document.getElementById('navbar');
  if (window.scrollY > 60) {
    nav.classList.add('scrolled');
  } else {
    nav.classList.remove('scrolled');
  }
  doReveal();
});

/* ── DOM READY ── */
document.addEventListener('DOMContentLoaded', function () {
  checkAuth();
  loadCart();

  var burger = document.getElementById('hamburger');
  if (burger) {
    burger.addEventListener('click', function () {
      document.getElementById('navMenu').classList.toggle('open');
    });
  }

  var dateInput = document.getElementById('cDate');
  if (dateInput) {
    dateInput.min = new Date().toISOString().split('T')[0];
  }

  setupShopFilter();
  updateBookNav();
  doReveal();
  setupCursor();
  updateProfileUI();
  updateChatApiHint();
  restoreChatUI();
});

/* ── AUTH & USER PROGRESS ── */
function getUsers() {
  try {
    return JSON.parse(storageGet(USERS_KEY) || '[]') || [];
  } catch (e) {
    return [];
  }
}

function saveUsers(users) {
  if (!storageSet(USERS_KEY, JSON.stringify(users))) {
    showToast('Could not save account — enable cookies/storage for this site');
    return false;
  }
  return true;
}

function getSession() {
  try {
    var raw = storageGet(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function setSession(session) {
  storageSet(SESSION_KEY, JSON.stringify(session));
  storageSet('soy_auth', 'true');
  if (session && session.email && !session.guest) {
    storageSet(REMEMBER_EMAIL_KEY, normalizeEmail(session.email));
  }
}

function clearSession() {
  storageRemove(SESSION_KEY);
  storageRemove('soy_auth');
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function userDataKey(email) {
  return 'soy_data_' + normalizeEmail(email);
}

function findUser(email) {
  var e = normalizeEmail(email);
  return getUsers().find(function (u) {
    return normalizeEmail(u.email) === e;
  });
}

function saveUserProgress() {
  var session = getSession();
  if (!session || session.guest) return;

  var quizResultsEl = document.getElementById('quizResults');
  var aiTextEl = document.getElementById('aiText');
  var skinTypeEl = document.getElementById('resultsSkinType');

  var payload = {
    cart: cart,
    quizAnswers: quizAnswers,
    quizDone: quizResultsEl && quizResultsEl.style.display !== 'none',
    quizSkinType: skinTypeEl ? skinTypeEl.textContent : '',
    quizAnalysis: aiTextEl ? aiTextEl.textContent : '',
    chatHistory: chatHistory.slice(-30),
    savedAt: Date.now()
  };

  storageSet(userDataKey(session.email), JSON.stringify(payload));
}

function loadUserProgress() {
  var session = getSession();
  if (!session || session.guest) return;

  var raw = storageGet(userDataKey(session.email));
  if (!raw) return;

  try {
    var data = JSON.parse(raw);
    if (data.cart && Array.isArray(data.cart)) {
      cart = data.cart;
      renderCart();
    }
    if (data.quizAnswers) {
      quizAnswers = data.quizAnswers;
    }
    if (data.chatHistory && data.chatHistory.length) {
      chatHistory = data.chatHistory;
    }
    if (data.quizDone) {
      var results = document.getElementById('quizResults');
      var intro = document.getElementById('quizIntro');
      var body = document.getElementById('quizBody');
      if (results && intro && body) {
        intro.style.display = 'none';
        body.style.display = 'none';
        results.style.display = 'block';
        if (data.quizSkinType) {
          document.getElementById('resultsSkinType').textContent = data.quizSkinType;
        }
        if (data.quizAnalysis) {
          document.getElementById('aiLoading').style.display = 'none';
          document.getElementById('aiText').style.display = 'block';
          document.getElementById('aiText').textContent = data.quizAnalysis;
        }
        populateResultsProducts();
      }
    }
  } catch (e) {
    console.warn('Could not load saved progress', e);
  }
}

function updateProfileUI() {
  var session = getSession();
  var avatar = document.getElementById('profileAvatar');
  var nameEl = document.getElementById('profileName');
  var guestRow = document.getElementById('profileGuestRows');
  var memberRow = document.getElementById('profileMemberRows');

  if (!avatar || !nameEl) return;

  if (!session || session.guest) {
    nameEl.textContent = 'Guest';
    avatar.textContent = 'G';
    if (guestRow) guestRow.style.display = 'block';
    if (memberRow) memberRow.style.display = 'none';
    return;
  }

  var initial = (session.name || session.email || '?').charAt(0).toUpperCase();
  avatar.textContent = initial;
  nameEl.textContent = session.name ? session.name.split(' ')[0] : 'You';
  if (guestRow) guestRow.style.display = 'none';
  if (memberRow) memberRow.style.display = 'block';
}

function hideAuthGate() {
  document.getElementById('authGate').classList.add('hidden');
  // Restore page scroll
  document.body.classList.add('auth-done');
  document.documentElement.classList.add('auth-done');
  // Show custom cursor again
  var cursor = document.getElementById('customCursor');
  if (cursor) cursor.classList.remove('auth-hidden');
  updateProfileUI();
}

function checkAuth() {
  var cursor = document.getElementById('customCursor');
  if (cursor) cursor.classList.add('auth-hidden');

  var session = getSession();
  var remembered = storageGet(REMEMBER_EMAIL_KEY);
  var loginEmail = document.getElementById('loginEmail');
  if (loginEmail && remembered) loginEmail.value = remembered;

  if (session && session.guest) {
    hideAuthGate();
    loadCart();
    updateProfileUI();
    return;
  }

  if (session && session.email && !session.guest) {
    var user = findUser(session.email);
    if (user) {
      setSession({ email: user.email, name: user.name, guest: false });
      hideAuthGate();
      loadUserProgress();
      loadCart();
      updateProfileUI();
      return;
    }
    clearSession();
  }

  if (loginEmail && remembered && !loginEmail.value) loginEmail.value = remembered;
}

function switchAuthTab(tab) {
  var isLogin = tab === 'login';
  document.getElementById('tabLogin').classList.toggle('active', isLogin);
  document.getElementById('tabSignup').classList.toggle('active', !isLogin);
  document.getElementById('formLogin').classList.toggle('active', isLogin);
  document.getElementById('formSignup').classList.toggle('active', !isLogin);
  clearAuthErrors();
}

function skipAuth() {
  setSession({ guest: true, name: 'Guest' });
  cart = [];
  quizAnswers = {};
  chatHistory = [];
  renderCart();
  hideAuthGate();
}

function clearAuthErrors() {
  ['loginEmailErr', 'loginPassErr', 'signupNameErr', 'signupEmailErr', 'signupPassErr', 'signupPass2Err'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.textContent = '';
  });
}

function doLogin() {
  clearAuthErrors();
  var email = document.getElementById('loginEmail').value.trim();
  var pass = document.getElementById('loginPass').value;
  var ok = true;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    document.getElementById('loginEmailErr').textContent = 'Please enter a valid email.';
    ok = false;
  }
  if (!pass) {
    document.getElementById('loginPassErr').textContent = 'Please enter your password.';
    ok = false;
  }
  if (!ok) return;

  var user = findUser(email);
  if (!user) {
    document.getElementById('loginEmailErr').textContent = 'No account found. Please sign up first.';
    return;
  }
  if (user.password !== pass) {
    document.getElementById('loginPassErr').textContent = 'Incorrect password. Try again.';
    return;
  }

  var rememberEl = document.getElementById('loginRemember');
  if (rememberEl && !rememberEl.checked) {
    storageRemove(REMEMBER_EMAIL_KEY);
  }

  setSession({ email: user.email, name: user.name, guest: false });
  loadUserProgress();
  loadCart();
  hideAuthGate();
  showToast('Welcome back, ' + user.name.split(' ')[0] + '!');
}

function doSignup() {
  clearAuthErrors();
  var name = document.getElementById('signupName').value.trim();
  var email = document.getElementById('signupEmail').value.trim();
  var pass = document.getElementById('signupPass').value;
  var pass2 = document.getElementById('signupPass2').value;
  var ok = true;

  if (name.length < 2) {
    document.getElementById('signupNameErr').textContent = 'Please enter your full name.';
    ok = false;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    document.getElementById('signupEmailErr').textContent = 'Please enter a valid email.';
    ok = false;
  }
  if (pass.length < 6) {
    document.getElementById('signupPassErr').textContent = 'Password must be at least 6 characters.';
    ok = false;
  }
  if (pass !== pass2) {
    document.getElementById('signupPass2Err').textContent = 'Passwords do not match.';
    ok = false;
  }
  if (!ok) return;

  if (findUser(email)) {
    document.getElementById('signupEmailErr').textContent = 'This email is already registered. Please log in.';
    return;
  }

  var normalizedEmail = normalizeEmail(email);
  var users = getUsers();
  users.push({ name: name, email: normalizedEmail, password: pass, createdAt: Date.now() });
  if (!saveUsers(users)) return;

  cart = [];
  quizAnswers = {};
  chatHistory = [];

  setSession({ email: normalizedEmail, name: name, guest: false });
  saveUserProgress();
  loadCart();
  hideAuthGate();
  showToast('Account created — welcome to Shades of You!');
}

function logoutUser() {
  var session = getSession();
  var wasMember = session && !session.guest;

  if (wasMember) saveUserProgress();

  clearSession();

  document.getElementById('profileDropdown').classList.remove('open');
  document.getElementById('authGate').classList.remove('hidden');
  document.body.classList.remove('auth-done');
  document.documentElement.classList.remove('auth-done');

  var loginEmail = document.getElementById('loginEmail');
  var remembered = storageGet(REMEMBER_EMAIL_KEY);
  if (loginEmail) loginEmail.value = remembered || '';
  document.getElementById('loginPass').value = '';

  switchAuthTab('login');
  updateProfileUI();

  if (wasMember) {
    showToast('Signed out — your account is saved. Log in anytime.');
  }
}

function toggleProfileMenu() {
  document.getElementById('profileDropdown').classList.toggle('open');
}

function openMyProgress() {
  document.getElementById('profileDropdown').classList.remove('open');
  showPage('quiz');
  var session = getSession();
  if (session && !session.guest) {
    loadUserProgress();
  }
}

/* ── MY ORDERS ── */
function ordersStorageKey() {
  var session = getSession();
  if (session && !session.guest && session.email) {
    return 'soy_orders_' + normalizeEmail(session.email);
  }
  return ORDERS_GUEST_KEY;
}

function getOrders() {
  try {
    return JSON.parse(storageGet(ordersStorageKey()) || '[]') || [];
  } catch (e) {
    return [];
  }
}

function saveOrdersList(orders) {
  storageSet(ordersStorageKey(), JSON.stringify(orders));
}

function saveOrder(order) {
  var orders = getOrders();
  orders.unshift(order);
  saveOrdersList(orders);
}

function formatOrderDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return iso;
  }
}

function renderMyOrders() {
  var body = document.getElementById('ordersModalBody');
  if (!body) return;

  var orders = getOrders();
  if (!orders.length) {
    body.innerHTML = '<p class="orders-empty">No orders yet. Add items to your bag and complete checkout — they will appear here.</p>';
    return;
  }

  body.innerHTML = orders
    .map(function (o) {
      var itemsText = (o.items || [])
        .map(function (it) {
          return it.name + ' × ' + it.qty;
        })
        .join('<br>');
      var statusClass = o.status === 'Shipped' ? 'shipped' : '';
      return (
        '<div class="order-card">' +
        '<div class="order-card-head">' +
        '<div><p class="order-id">' +
        o.id +
        '</p><p class="order-date">' +
        formatOrderDate(o.placedAt) +
        '</p></div>' +
        '<span class="order-status ' +
        statusClass +
        '">' +
        (o.status || 'Processing') +
        '</span></div>' +
        '<div class="order-items">' +
        itemsText +
        '</div>' +
        '<p class="order-total">Total: ₹' +
        (o.total || 0).toLocaleString('en-IN') +
        ' · ' +
        (o.paymentLabel || 'Paid') +
        '</p>' +
        (o.delivery && o.delivery.city
          ? '<p class="order-delivery">Deliver to ' +
            o.delivery.city +
            ', ' +
            (o.delivery.state || '') +
            ' ' +
            (o.delivery.pin || '') +
            '</p>'
          : '') +
        '</div>'
      );
    })
    .join('');
}

function openMyOrders() {
  document.getElementById('profileDropdown').classList.remove('open');
  renderMyOrders();
  document.getElementById('ordersOverlay').classList.add('show');
  document.getElementById('ordersModal').classList.add('open');
}

function closeMyOrders() {
  document.getElementById('ordersOverlay').classList.remove('show');
  document.getElementById('ordersModal').classList.remove('open');
}

document.addEventListener('click', function (e) {
  var wrap = document.getElementById('navProfile');
  if (wrap && !wrap.contains(e.target)) {
    var dd = document.getElementById('profileDropdown');
    if (dd) dd.classList.remove('open');
  }
});

/* ── PAGE NAVIGATION WITH WIPE ── */
function showPage(name) {
  var overlay = document.getElementById('pageTransition');
  overlay.classList.remove('wipe-out');
  overlay.classList.add('wipe-in');

  setTimeout(function () {
    document.querySelectorAll('.page').forEach(function (p) {
      p.classList.remove('active');
    });
    var page = document.getElementById('page-' + name);
    if (page) page.classList.add('active');

    document.querySelectorAll('.nav-link').forEach(function (link) {
      link.classList.remove('active');
    });
    var activeLink = document.getElementById('nl-' + name);
    if (activeLink) activeLink.classList.add('active');

    document.getElementById('navMenu').classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

    if (name === 'about') {
      setTimeout(startCounters, 400);
    }
    if (name === 'checkout') {
      setTimeout(renderCheckoutSummary, 50);
    }
    doReveal();
  }, 200);

  setTimeout(function () {
    overlay.classList.remove('wipe-in');
    overlay.classList.add('wipe-out');
  }, 450);

  setTimeout(function () {
    overlay.classList.remove('wipe-out');
  }, 900);
}

function goShop(category) {
  showPage('shop');
  setTimeout(function () {
    filterProducts(category);
  }, 250);
}

/* ── CART ── */
function saveCart() {
  var session = getSession();
  if (!session || session.guest) {
    storageSet('soy_cart_guest', JSON.stringify(cart));
  } else {
    saveUserProgress();
  }
}

function loadCart() {
  var session = getSession();
  if (session && !session.guest) {
    var raw = storageGet(userDataKey(session.email));
    if (raw) {
      try {
        var data = JSON.parse(raw);
        if (data.cart && Array.isArray(data.cart)) {
          cart = data.cart;
          renderCart();
          return;
        }
      } catch (e) {}
    }
  }
  var guestStored = storageGet('soy_cart_guest');
  if (guestStored) {
    try {
      cart = JSON.parse(guestStored);
    } catch (e) {
      cart = [];
    }
    renderCart();
  }
}

function addToCart(name, price) {
  var existing = cart.find(function (item) {
    return item.name === name;
  });
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ name: name, price: price, qty: 1 });
  }
  renderCart();
  showToast('Added: ' + name);
  openCart();
}

function removeFromCart(name) {
  cart = cart.filter(function (item) {
    return item.name !== name;
  });
  renderCart();
}

function renderCart() {
  var badge = document.getElementById('cartBadge');
  var items = document.getElementById('cartItems');
  var footer = document.getElementById('cartFooter');
  var total = document.getElementById('cartTotal');

  var totalQty = cart.reduce(function (sum, item) {
    return sum + item.qty;
  }, 0);
  badge.textContent = totalQty;

  if (!cart.length) {
    items.innerHTML = '<p class="cart-empty">Your bag is empty.</p>';
    footer.style.display = 'none';
    saveCart();
    return;
  }

  items.innerHTML = cart
    .map(function (item) {
      var safeName = item.name.replace(/'/g, "\\'");
      return (
        '<motion class="cart-item">' +
        '<span class="cart-item-name">' +
        item.name +
        ' × ' +
        item.qty +
        '</span>' +
        '<span class="cart-item-price">₹' +
        (item.price * item.qty).toLocaleString('en-IN') +
        '</span>' +
        '<button class="cart-item-rm" onclick="removeFromCart(\'' +
        safeName +
        "')\">✕</button>" +
        '</motion>'
      );
    })
    .join('')
    .replace(/<motion class="cart-item">/g, '<div class="cart-item">')
    .replace(/<\/motion>/g, '</div>');

  var sum = cart.reduce(function (s, item) {
    return s + item.price * item.qty;
  }, 0);
  total.textContent = '₹' + sum.toLocaleString('en-IN');
  footer.style.display = 'block';
  saveCart();
}

function toggleCart() {
  document.getElementById('cartSidebar').classList.toggle('open');
  document.getElementById('cartOverlay').classList.toggle('show');
}

function openCart() {
  document.getElementById('cartSidebar').classList.add('open');
  document.getElementById('cartOverlay').classList.add('show');
}

/* ── TOAST ── */
function showToast(msg) {
  var old = document.getElementById('_toast');
  if (old) old.remove();

  var t = document.createElement('div');
  t.id = '_toast';
  t.className = 'site-toast';
  t.textContent = '✓ ' + msg;
  document.body.appendChild(t);

  requestAnimationFrame(function () {
    t.classList.add('show');
  });
  setTimeout(function () {
    t.classList.remove('show');
    setTimeout(function () {
      t.remove();
    }, 350);
  }, 2600);
}

/* ── NEWSLETTER ── */
function nlSub() {
  var val = document.getElementById('nlEmail').value.trim();
  var msg = document.getElementById('nlMsg');
  var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
  if (!emailOk) {
    msg.textContent = 'Please enter a valid email.';
    msg.className = 'nl-msg err';
    return;
  }
  msg.textContent = "✓ You're subscribed!";
  msg.className = 'nl-msg ok';
  document.getElementById('nlEmail').value = '';
}

/* ── SHOP FILTER ── */
function setupShopFilter() {
  document.querySelectorAll('.filter-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.filter-btn').forEach(function (b) {
        b.classList.remove('active');
      });
      btn.classList.add('active');
      filterProducts(btn.dataset.filter);
    });
  });
}

function filterProducts(filter) {
  document.querySelectorAll('.filter-btn').forEach(function (b) {
    b.classList.toggle('active', b.dataset.filter === filter);
  });

  document.querySelectorAll('.shop-item').forEach(function (item) {
    if (filter === 'all' || item.dataset.cat === filter) {
      item.classList.remove('hidden');
    } else {
      item.classList.add('hidden');
    }
  });
}

/* ── SCROLL REVEAL ── */
function doReveal() {
  if (!revealObserver) {
    revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -30px 0px' }
    );
  }

  document.querySelectorAll('[data-reveal]:not(.revealed)').forEach(function (el) {
    revealObserver.observe(el);
  });
}

/* ── BOOK / PAGE FLIP ── */
function turnPage(direction) {
  if (isFlipping) return;
  var next = currentSpread + direction;
  if (next < 1 || next > totalSpreads) return;
  isFlipping = true;

  var leaving = document.getElementById('spread-' + currentSpread);
  var entering = document.getElementById('spread-' + next);

  if (direction > 0) {
    // Forward: animate leaving spread's right page flipping left
    entering.style.opacity = '1';
    entering.style.pointerEvents = 'none';
    leaving.classList.add('flip-forward');

    setTimeout(function () {
      leaving.classList.remove('active', 'flip-forward');
      leaving.style.opacity = '';
      entering.style.opacity = '';
      entering.style.pointerEvents = '';
      entering.classList.add('active');
      isFlipping = false;
    }, 750);
  } else {
    // Backward: show entering behind, flip left page of entering back rightward
    entering.classList.add('active');
    entering.classList.add('flip-backward');
    leaving.style.zIndex = '5';

    setTimeout(function () {
      leaving.classList.remove('active');
      leaving.style.zIndex = '';
      entering.classList.remove('flip-backward');
      isFlipping = false;
    }, 750);
  }

  currentSpread = next;
  updateBookDots();
  updateBookNav();
}

function goToSpread(n) {
  if (n === currentSpread || isFlipping) return;
  var direction = n > currentSpread ? 1 : -1;

  function step() {
    if (currentSpread === n) return;
    turnPage(direction);
    setTimeout(step, 750);
  }
  step();
}

function updateBookDots() {
  document.querySelectorAll('.book-dot').forEach(function (dot, i) {
    dot.classList.toggle('active', i + 1 === currentSpread);
  });
}

function updateBookNav() {
  document.getElementById('bookPrev').disabled = currentSpread === 1;
  document.getElementById('bookNext').disabled = currentSpread === totalSpreads;
}

/* ── QUIZ ── */
function startQuiz() {
  document.getElementById('quizIntro').style.display = 'none';
  document.getElementById('quizBody').style.display = 'block';
  document.getElementById('quizResults').style.display = 'none';
  updateQuizProgress(1);
}

function selectOpt(questionNum, btn) {
  btn.closest('.quiz-options').querySelectorAll('.quiz-opt').forEach(function (b) {
    b.classList.remove('selected');
  });
  btn.classList.add('selected');
  quizAnswers[questionNum] = btn.dataset.val;
  document.getElementById('qnext' + questionNum).disabled = false;
}

function quizNext(step) {
  document.getElementById('qq' + step).classList.remove('active');
  document.getElementById('qq' + (step + 1)).classList.add('active');
  updateQuizProgress(step + 1);
}

function quizPrev(step) {
  document.getElementById('qq' + step).classList.remove('active');
  document.getElementById('qq' + (step - 1)).classList.add('active');
  updateQuizProgress(step - 1);
}

function updateQuizProgress(step) {
  document.getElementById('quizStepLabel').textContent = 'Question ' + step + ' of 5';
  document.getElementById('quizFill').style.width = (step / 5) * 100 + '%';
}

function submitQuiz() {
  document.getElementById('quizBody').style.display = 'none';
  document.getElementById('quizResults').style.display = 'block';

  document.getElementById('resultsSkinType').textContent = getSkinTypeLabel();
  populateResultsProducts();
  saveUserProgress();

  document.getElementById('aiLoading').style.display = 'flex';
  document.getElementById('aiText').style.display = 'none';
  document.getElementById('aiText').textContent = '';
  callQuizAnalysisAPI();
}

function getSkinTypeLabel() {
  var skin = quizAnswers[1];
  var map = {
    oily: 'Oily Skin',
    dry: 'Dry & Thirsty Skin',
    combination: 'Combination-Prone Skin',
    normal: 'Balanced Skin',
    sensitive: 'Sensitive Skin'
  };
  return map[skin] || 'Your Unique Skin Type';
}

function populateResultsProducts() {
  var concern = quizAnswers[3];
  var skin = quizAnswers[1];
  var recommended = PRODUCTS.filter(function (p) {
    return p.cat.includes(skin) || p.cat.includes(concern);
  }).slice(0, 3);

  if (recommended.length < 3) {
    recommended = PRODUCTS.slice(0, 3);
  }

  document.getElementById('resultsProducts').innerHTML = recommended
    .map(function (p) {
      var safeName = p.name.replace(/'/g, "\\'");
      return (
        '<div class="result-product-card">' +
        '<p class="result-tag">Recommended</p>' +
        '<p class="result-name">' +
        p.name +
        '</p>' +
        '<p class="result-price">₹' +
        p.price.toLocaleString('en-IN') +
        '</p>' +
        '<button type="button" class="btn-result-add" onclick="addToCart(\'' +
        safeName +
        "', " +
        p.price +
        ')">Add to Bag</button>' +
        '</div>'
      );
    })
    .join('');
}

async function callQuizAnalysisAPI() {
  var prompt =
    'Quiz answers: skin feel at midday: ' +
    quizAnswers[1] +
    ', breakout frequency: ' +
    quizAnswers[2] +
    ', top concern: ' +
    quizAnswers[3] +
    ', reaction to new products: ' +
    quizAnswers[4] +
    ', current routine: ' +
    quizAnswers[5] +
    '.';

  try {
    var text = await callGemini(QUIZ_SYSTEM_PROMPT, [{ role: 'user', content: prompt }]);
    document.getElementById('aiLoading').style.display = 'none';
    document.getElementById('aiText').style.display = 'block';
    document.getElementById('aiText').textContent = text;
  } catch (e) {
    document.getElementById('aiLoading').style.display = 'none';
    document.getElementById('aiText').style.display = 'block';
    document.getElementById('aiText').textContent =
      'Based on your answers, focus on gentle cleansing, hydration, and daily SPF. Try Radiance Glow Serum and Velvet Moisturiser — book a free consult for a full plan!';
    console.warn('Quiz AI:', e.message);
  }
  saveUserProgress();
}

function resetQuiz() {
  quizAnswers = {};
  document.getElementById('quizResults').style.display = 'none';
  document.getElementById('quizBody').style.display = 'none';
  document.getElementById('quizIntro').style.display = 'block';
  document.querySelectorAll('.quiz-opt').forEach(function (b) {
    b.classList.remove('selected');
  });
  document.querySelectorAll('[id^="qnext"]').forEach(function (b) {
    b.disabled = true;
  });
  document.querySelectorAll('.quiz-question').forEach(function (q, i) {
    q.classList.toggle('active', i === 0);
  });
  document.getElementById('quizFill').style.width = '0%';
  document.getElementById('aiText').style.display = 'none';
  document.getElementById('aiLoading').style.display = 'flex';
  saveUserProgress();
}

/* ── CONSULTATION FORM ── */
function cNext(step) {
  if (!cValidate(step)) return;

  document.getElementById('dot' + step).classList.add('done');
  document.getElementById('dot' + step).classList.remove('active');
  document.getElementById('lbl' + step).classList.remove('active');
  document.getElementById('line' + step).classList.add('done');

  document.getElementById('step' + step).classList.remove('active');
  document.getElementById('step' + (step + 1)).classList.add('active');
  document.getElementById('dot' + (step + 1)).classList.add('active');
  document.getElementById('lbl' + (step + 1)).classList.add('active');
}

function cPrev(step) {
  document.getElementById('step' + step).classList.remove('active');
  document.getElementById('step' + (step - 1)).classList.add('active');
  document.getElementById('dot' + (step - 1)).classList.remove('done');
  document.getElementById('dot' + (step - 1)).classList.add('active');
  document.getElementById('lbl' + (step - 1)).classList.add('active');
  document.getElementById('line' + (step - 1)).classList.remove('done');
}

function cValidate(step) {
  var ok = true;

  function setErr(id, msg) {
    document.getElementById(id).textContent = msg;
    if (msg) ok = false;
  }

  if (step === 1) {
    setErr('cNameErr', document.getElementById('cName').value.trim().length < 2 ? 'Please enter your name.' : '');
    setErr(
      'cEmailErr',
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(document.getElementById('cEmail').value.trim()) ? 'Please enter a valid email.' : ''
    );
    setErr('cAgeErr', !document.getElementById('cAge').value ? 'Please select your age range.' : '');
  }
  if (step === 2) {
    setErr('cSkinErr', !document.getElementById('cSkin').value ? 'Please select your skin type.' : '');
    setErr('cConcernErr', !document.getElementById('cConcern').value ? 'Please select a concern.' : '');
  }
  return ok;
}

function cSubmit() {
  var ok = true;
  function setErr(id, msg) {
    document.getElementById(id).textContent = msg;
    if (msg) ok = false;
  }
  var today = new Date().toISOString().split('T')[0];
  setErr(
    'cDateErr',
    !document.getElementById('cDate').value || document.getElementById('cDate').value < today
      ? 'Please pick a future date.'
      : ''
  );
  setErr('cTimeErr', !document.getElementById('cTime').value ? 'Please select a time slot.' : '');
  if (!ok) return;

  document.getElementById('dot3').classList.add('done');
  document.getElementById('step3').classList.remove('active');
  document.getElementById('stepOk').classList.add('active');

  if (typeof confetti === 'function') {
    confetti({
      particleCount: 90,
      spread: 70,
      colors: ['#C8A98A', '#8B6348', '#F5F0EA', '#1A1108'],
      origin: { y: 0.6 }
    });
  }
}

/* ── CONTACT FORM ── */
function ctSubmit() {
  var ok = true;
  function setErr(id, msg) {
    document.getElementById(id).textContent = msg;
    if (msg) ok = false;
  }
  setErr('ctNameErr', document.getElementById('ctName').value.trim().length < 2 ? 'Please enter your name.' : '');
  setErr(
    'ctEmailErr',
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(document.getElementById('ctEmail').value.trim()) ? 'Please enter a valid email.' : ''
  );
  setErr('ctSubjectErr', !document.getElementById('ctSubject').value ? 'Please select a subject.' : '');
  setErr('ctMsgErr', document.getElementById('ctMsg').value.trim().length < 10 ? 'Please write at least 10 characters.' : '');
  if (!ok) return;

  document.getElementById('ctSuccess').style.display = 'block';
  ['ctName', 'ctEmail', 'ctSubject', 'ctMsg'].forEach(function (id) {
    document.getElementById(id).value = '';
  });
}

/* ── COUNTERS ── */
function startCounters() {
  document.querySelectorAll('.stat-num[data-target]').forEach(function (el) {
    if (el._counted) return;
    el._counted = true;

    var target = parseInt(el.dataset.target, 10);
    var start = null;
    var duration = 1800;

    function step(timestamp) {
      if (!start) start = timestamp;
      var progress = Math.min((timestamp - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.floor(eased * target).toLocaleString('en-IN');
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
}

/* ── CHATBOT (AI via Gemini API) ── */
function toggleChatApiPanel() {
  var panel = document.getElementById('chatApiPanel');
  if (panel) panel.classList.toggle('open');
  var input = document.getElementById('chatApiKeyInput');
  if (input && panel && panel.classList.contains('open')) {
    input.value = getGeminiApiKey();
    input.focus();
  }
}

function updateChatApiHint() {
  var hint = document.getElementById('chatApiHint');
  var status = document.getElementById('chatStatus');
  if (!hint) return;
  if (isGeminiConfigured()) {
    hint.textContent = '✓ API connected — Sage answers with real AI.';
    hint.className = 'chat-api-hint ok';
    if (status) status.textContent = 'AI · Online';
  } else {
    hint.textContent = 'Add your Gemini API key (🔑) for intelligent answers.';
    hint.className = 'chat-api-hint err';
    if (status) status.textContent = 'AI · Key required';
  }
}

function saveChatApiKey() {
  var input = document.getElementById('chatApiKeyInput');
  var key = input ? input.value.trim() : '';
  if (key.length < 10) {
    updateChatApiHint();
    showToast('Enter a valid Gemini API key');
    return;
  }
  storageSet(GEMINI_API_KEY_STORAGE, key);
  storageRemove(GEMINI_MODEL_CACHE_KEY);
  updateChatApiHint();
  showToast('API key saved — Sage is ready!');
  document.getElementById('chatApiPanel').classList.remove('open');
}

function restoreChatUI() {
  var container = document.getElementById('chatMessages');
  var welcome = document.getElementById('chatWelcome');
  var typing = document.getElementById('chatTyping');
  if (!container) return;

  container.querySelectorAll('.chat-bubble:not(#chatWelcome)').forEach(function (b) {
    b.remove();
  });

  if (chatHistory.length) {
    if (welcome) welcome.style.display = 'none';
    chatHistory.forEach(function (m) {
      if (m.role === 'user' || m.role === 'assistant') {
        addBubble(m.content, m.role === 'user' ? 'user' : 'bot', false);
      }
    });
  } else if (welcome) {
    welcome.style.display = 'block';
  }

  if (typing) container.appendChild(typing);
}

function toggleChat() {
  var win = document.getElementById('chatWindow');
  var fab = document.getElementById('chatFab');
  win.classList.toggle('open');
  var icon = fab.querySelector('i');
  icon.className = win.classList.contains('open') ? 'fas fa-times' : 'fas fa-comment-dots';
  if (win.classList.contains('open')) {
    restoreChatUI();
    document.getElementById('chatInput').focus();
  }
}

function addBubble(text, sender, scroll) {
  if (scroll === undefined) scroll = true;
  var container = document.getElementById('chatMessages');
  var typing = document.getElementById('chatTyping');
  var bubble = document.createElement('div');
  bubble.className = 'chat-bubble ' + (sender === 'bot error' ? 'bot error' : sender);
  bubble.textContent = text;
  if (typing) {
    container.insertBefore(bubble, typing);
  } else {
    container.appendChild(bubble);
  }
  if (scroll) container.scrollTop = container.scrollHeight;
}

function trimChatHistoryForApi() {
  if (chatHistory.length <= CHAT_HISTORY_LIMIT) return chatHistory;
  return chatHistory.slice(-CHAT_HISTORY_LIMIT);
}

var chatSending = false;

async function sendChat(presetMsg) {
  if (chatSending) return;

  var input = document.getElementById('chatInput');
  var sendBtn = document.getElementById('chatSendBtn');
  var msg = (presetMsg || input.value).trim();
  if (!msg) return;

  if (!isGeminiConfigured()) {
    addBubble(
      'To use real AI, tap the 🔑 icon above and paste your free Google Gemini API key from aistudio.google.com/apikey',
      'bot error'
    );
    document.getElementById('chatApiPanel').classList.add('open');
    return;
  }

  var welcome = document.getElementById('chatWelcome');
  if (welcome) welcome.style.display = 'none';

  if (!presetMsg) {
    addBubble(msg, 'user');
    input.value = '';
  }

  chatHistory.push({ role: 'user', content: msg });
  document.getElementById('quickReplies').style.display = 'none';
  document.getElementById('chatTyping').style.display = 'flex';
  chatSending = true;
  if (input) input.disabled = true;
  if (sendBtn) sendBtn.disabled = true;

  var reply;
  try {
    reply = await callGemini(CHAT_SYSTEM_PROMPT, trimChatHistoryForApi());
    chatHistory.push({ role: 'assistant', content: reply });
  } catch (e) {
    console.warn('Chat AI:', e.message);
    var hint = isModelNotFoundError(e.message)
      ? ' Your API key is valid but the model name changed — refresh the page and try again.'
      : ' Check your API key with 🔑 (aistudio.google.com/apikey) or try again.';
    reply = 'I could not reach the AI right now (' + e.message + ').' + hint;
    chatHistory.push({ role: 'assistant', content: reply });
  }

  document.getElementById('chatTyping').style.display = 'none';
  addBubble(reply, 'bot');
  chatSending = false;
  if (input) {
    input.disabled = false;
    input.focus();
  }
  if (sendBtn) sendBtn.disabled = false;
  saveUserProgress();
}

function quickReply(msg) {
  addBubble(msg, 'user');
  sendChat(msg);
}

/* ── CUSTOM CURSOR — rose petal trails ── */
function setupCursor() {
  var cursor = document.getElementById('customCursor');
  if (!cursor || window.matchMedia('(max-width: 768px)').matches) return;

  var petalTimer = 0;

  document.addEventListener('mousemove', function (e) {
    cursor.style.left = e.clientX + 'px';
    cursor.style.top = e.clientY + 'px';

    // Spawn petal trail every ~60ms
    var now = Date.now();
    if (now - petalTimer > 60) {
      petalTimer = now;
      var petal = document.createElement('div');
      petal.className = 'cursor-petal';
      petal.style.left = e.clientX + 'px';
      petal.style.top = e.clientY + 'px';
      petal.style.setProperty('--r', (Math.random() * 360) + 'deg');
      document.body.appendChild(petal);
      setTimeout(function() { petal.remove(); }, 800);
    }
  });

  document.querySelectorAll('a, button, [onclick], .cat-card, .shop-item, .quiz-opt, .book-dot').forEach(function (el) {
    el.addEventListener('mouseenter', function () {
      cursor.classList.add('enlarged');
    });
    el.addEventListener('mouseleave', function () {
      cursor.classList.remove('enlarged');
    });
  });
}
/* ══════════════════════════════════════════
   CHECKOUT
══════════════════════════════════════════ */
var activePayTab = 'card';
var selectedWallet = null;
var appliedDiscount = 0;

function openCheckout() {
  toggleCart();
  showPage('checkout');
  renderCheckoutSummary();
}

function renderCheckoutSummary() {
  var itemsEl = document.getElementById('ckSummaryItems');
  var totalsEl = document.getElementById('ckSummaryTotals');
  if (!itemsEl) return;

  if (!cart.length) {
    itemsEl.innerHTML = '<p class="summary-empty">Add items to your bag first.</p>';
    if (totalsEl) totalsEl.style.display = 'none';
    return;
  }

  itemsEl.innerHTML = cart.map(function(item) {
    return '<div class="summary-item">' +
      '<div class="summary-item-img">🧴</div>' +
      '<div class="summary-item-info">' +
        '<p class="summary-item-name">' + item.name + '</p>' +
        '<p class="summary-item-qty">Qty: ' + item.qty + '</p>' +
      '</div>' +
      '<span class="summary-item-price">₹' + (item.price * item.qty).toLocaleString('en-IN') + '</span>' +
    '</div>';
  }).join('');

  updateCheckoutTotals();
  if (totalsEl) totalsEl.style.display = 'block';
}

function updateCheckoutTotals() {
  var subtotal = cart.reduce(function(s, item) { return s + item.price * item.qty; }, 0);
  var shipping = subtotal >= 2500 ? 0 : 149;
  var cod = activePayTab === 'cod' ? 50 : 0;
  var grand = subtotal + shipping + cod - appliedDiscount;

  var sub = document.getElementById('ckSubtotal');
  var ship = document.getElementById('ckShipping');
  var grandEl = document.getElementById('ckGrand');
  var discRow = document.getElementById('ckDiscountRow');
  var codRow = document.getElementById('ckCodRow');
  var discEl = document.getElementById('ckDiscount');

  if (sub) sub.textContent = '₹' + subtotal.toLocaleString('en-IN');
  if (ship) ship.textContent = shipping === 0 ? 'FREE' : '₹' + shipping;
  if (grandEl) grandEl.textContent = '₹' + grand.toLocaleString('en-IN');
  if (discRow) discRow.style.display = appliedDiscount > 0 ? 'flex' : 'none';
  if (discEl) discEl.textContent = '-₹' + appliedDiscount.toLocaleString('en-IN');
  if (codRow) codRow.style.display = cod > 0 ? 'flex' : 'none';
}

function switchPayTab(tab) {
  activePayTab = tab;
  ['card','upi','wallet','cod'].forEach(function(t) {
    var btn = document.getElementById('pt' + t.charAt(0).toUpperCase() + t.slice(1));
    var panel = document.getElementById('panel' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) btn.classList.toggle('active', t === tab);
    if (panel) panel.classList.toggle('active', t === tab);
  });
  updateCheckoutTotals();
}

function selectWallet(el) {
  document.querySelectorAll('.wallet-opt').forEach(function(w) { w.classList.remove('selected'); });
  el.classList.add('selected');
  selectedWallet = el.textContent.trim();
  document.getElementById('ckWalletErr').textContent = '';
}

function formatCardNum(input) {
  var v = input.value.replace(/\D/g, '').slice(0, 16);
  input.value = v.match(/.{1,4}/g) ? v.match(/.{1,4}/g).join('  ') : v;
}

function formatExpiry(input) {
  var v = input.value.replace(/\D/g, '').slice(0, 4);
  if (v.length >= 3) v = v.slice(0, 2) + ' / ' + v.slice(2);
  input.value = v;
}

function verifyUpi() {
  var val = document.getElementById('ckUpiId').value.trim();
  var err = document.getElementById('ckUpiErr');
  if (!val || !val.includes('@')) {
    err.textContent = 'Please enter a valid UPI ID (e.g. name@upi).';
    return;
  }
  err.textContent = '✓ UPI ID looks valid!';
  err.style.color = '#2d8b55';
  setTimeout(function() { err.textContent = ''; err.style.color = ''; }, 3000);
}

var COUPONS = { 'GLOW10': 0.10, 'SOY20': 0.20, 'WELCOME15': 0.15 };
function applyCoupon() {
  var code = document.getElementById('ckCoupon').value.trim().toUpperCase();
  var msg = document.getElementById('couponMsg');
  var subtotal = cart.reduce(function(s, i) { return s + i.price * i.qty; }, 0);

  if (!code) { msg.textContent = 'Please enter a coupon code.'; msg.className = 'coupon-feedback err'; return; }
  if (COUPONS[code]) {
    appliedDiscount = Math.round(subtotal * COUPONS[code]);
    msg.textContent = '✓ ' + (COUPONS[code] * 100) + '% off applied! You save ₹' + appliedDiscount.toLocaleString('en-IN');
    msg.className = 'coupon-feedback ok';
    updateCheckoutTotals();
  } else {
    appliedDiscount = 0;
    msg.textContent = 'Invalid coupon code. Try GLOW10 for 10% off!';
    msg.className = 'coupon-feedback err';
    updateCheckoutTotals();
  }
}

function ckSetErr(id, msg) {
  var el = document.getElementById(id);
  if (el) el.textContent = msg;
  return !!msg;
}

function validateCheckout() {
  var errors = 0;
  var name = document.getElementById('ckName') ? document.getElementById('ckName').value.trim() : '';
  var phone = document.getElementById('ckPhone') ? document.getElementById('ckPhone').value.trim() : '';
  var email = document.getElementById('ckEmail') ? document.getElementById('ckEmail').value.trim() : '';
  var addr1 = document.getElementById('ckAddr1') ? document.getElementById('ckAddr1').value.trim() : '';
  var city = document.getElementById('ckCity') ? document.getElementById('ckCity').value.trim() : '';
  var state = document.getElementById('ckState') ? document.getElementById('ckState').value : '';
  var pin = document.getElementById('ckPin') ? document.getElementById('ckPin').value.trim() : '';

  if (ckSetErr('ckNameErr', name.length < 2 ? 'Please enter your full name.' : '')) errors++;
  if (ckSetErr('ckPhoneErr', !/^[6-9]\d{9}$/.test(phone.replace(/\s|\+91/g,'')) ? 'Enter a valid 10-digit Indian number.' : '')) errors++;
  if (ckSetErr('ckEmailErr', !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'Enter a valid email.' : '')) errors++;
  if (ckSetErr('ckAddr1Err', addr1.length < 5 ? 'Enter your delivery address.' : '')) errors++;
  if (ckSetErr('ckCityErr', city.length < 2 ? 'Enter your city.' : '')) errors++;
  if (ckSetErr('ckStateErr', !state ? 'Select your state.' : '')) errors++;
  if (ckSetErr('ckPinErr', !/^\d{6}$/.test(pin) ? 'Enter a valid 6-digit PIN code.' : '')) errors++;

  if (activePayTab === 'card') {
    var cardNum = document.getElementById('ckCardNum') ? document.getElementById('ckCardNum').value.replace(/\s/g,'') : '';
    var expiry = document.getElementById('ckExpiry') ? document.getElementById('ckExpiry').value : '';
    var cvv = document.getElementById('ckCvv') ? document.getElementById('ckCvv').value : '';
    var cardName = document.getElementById('ckCardName') ? document.getElementById('ckCardName').value.trim() : '';
    if (ckSetErr('ckCardNumErr', cardNum.length < 16 ? 'Enter a valid card number.' : '')) errors++;
    if (ckSetErr('ckExpiryErr', !expiry.includes('/') ? 'Enter a valid expiry (MM / YY).' : '')) errors++;
    if (ckSetErr('ckCvvErr', cvv.length < 3 ? 'Enter a valid CVV.' : '')) errors++;
    if (ckSetErr('ckCardNameErr', cardName.length < 2 ? 'Enter the name on card.' : '')) errors++;
  } else if (activePayTab === 'upi') {
    var upiId = document.getElementById('ckUpiId') ? document.getElementById('ckUpiId').value.trim() : '';
    if (ckSetErr('ckUpiErr', !upiId.includes('@') ? 'Enter a valid UPI ID.' : '')) errors++;
  } else if (activePayTab === 'wallet') {
    if (ckSetErr('ckWalletErr', !selectedWallet ? 'Please select a wallet.' : '')) errors++;
  }

  return errors === 0;
}

function placeOrder() {
  if (!cart.length) { showToast('Your bag is empty — add items first!'); return; }
  if (!validateCheckout()) return;

  var subtotal = cart.reduce(function (s, item) { return s + item.price * item.qty; }, 0);
  var shipping = subtotal >= 2500 ? 0 : 149;
  var cod = activePayTab === 'cod' ? 50 : 0;
  var grand = subtotal + shipping + cod - appliedDiscount;

  var payLabels = { card: 'Card', upi: 'UPI', wallet: 'Wallet', cod: 'Cash on Delivery' };

  var orderId = 'SOY-' + Math.floor(100000 + Math.random() * 900000);
  var orderRecord = {
    id: orderId,
    placedAt: new Date().toISOString(),
    status: 'Processing',
    items: cart.map(function (item) {
      return { name: item.name, price: item.price, qty: item.qty };
    }),
    subtotal: subtotal,
    shipping: shipping,
    discount: appliedDiscount,
    codFee: cod,
    total: grand,
    paymentMethod: activePayTab,
    paymentLabel: payLabels[activePayTab] || 'Paid',
    delivery: {
      name: document.getElementById('ckName').value.trim(),
      city: document.getElementById('ckCity').value.trim(),
      state: document.getElementById('ckState').value,
      pin: document.getElementById('ckPin').value.trim()
    }
  };

  saveOrder(orderRecord);

  document.getElementById('ckOrderId').textContent = 'Order #' + orderId;
  document.getElementById('ckSuccess').classList.add('show');
  document.querySelector('.checkout-form-card').style.opacity = '0.35';
  document.querySelector('.checkout-form-card').style.pointerEvents = 'none';

  if (typeof confetti === 'function') {
    confetti({ particleCount: 120, spread: 80, colors: ['#C8A98A','#8B6348','#F5F0EA','#1A1108'], origin: { y: 0.5 } });
  }

  cart = [];
  renderCart();
  saveCart();
  appliedDiscount = 0;
  showToast('Order saved — view it in My Orders');
}
