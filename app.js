// ── Sources ───────────────────────────────────────────────────────────────
// Greenhouse slugs marked "confirmed" are verified; others gracefully fail if wrong.
const SOURCES = [
  // Greenhouse — confirmed
  { name: 'Stoke Space',           slug: 'stokespacetechnologies', api: 'greenhouse', color: '#f05a28' },
  { name: 'SpaceX',                slug: 'spacex',                 api: 'greenhouse', color: '#4d9fff' },
  { name: 'Relativity Space',      slug: 'relativity',             api: 'greenhouse', color: '#a259ff' },
  { name: 'Rocket Lab',            slug: 'rocketlab',              api: 'greenhouse', color: '#e8c84a' },
  { name: 'Inversion Space',       slug: 'inversionspace',         api: 'greenhouse', color: '#ff6b6b' },
  { name: 'Varda Space',           slug: 'vardaspace',             api: 'greenhouse', color: '#80cbc4' },
  // Greenhouse — likely (graceful failure if slug is wrong)
  { name: 'Vast Space',            slug: 'vast',                   api: 'greenhouse', color: '#26c6da' },
  { name: 'Astranis',              slug: 'astranis',               api: 'greenhouse', color: '#66bb6a' },
  { name: 'Muon Space',            slug: 'muonspace',              api: 'greenhouse', color: '#ff8a65' },
  { name: 'Albedo',                slug: 'albedo',                 api: 'greenhouse', color: '#ba68c8' },
  { name: 'True Anomaly',          slug: 'trueanomalyinc',         api: 'greenhouse', color: '#ef5350' },
  { name: 'Ursa Major',            slug: 'ursamajor',              api: 'greenhouse', color: '#ffa726' },
  { name: 'AST SpaceMobile',       slug: 'astspacemobile',         api: 'greenhouse', color: '#26a69a' },
  { name: 'Anduril',               slug: 'andurilindustries',      api: 'greenhouse', color: '#5c6bc0' },
  { name: 'Voyager Technologies',  slug: 'voyagertechnologiesinc', api: 'greenhouse', color: '#8d6e63' },
  { name: 'Planet Labs',           slug: 'planetlabs',             api: 'greenhouse', color: '#4db6ac' },
  { name: 'BlackSky',              slug: 'blacksky',               api: 'greenhouse', color: '#7986cb' },
  // Lever — confirmed
  { name: 'Hermeus',               slug: 'hermeus',                api: 'lever',      color: '#ff5252' },
  { name: 'CesiumAstro',           slug: 'CesiumAstro',            api: 'lever',      color: '#40c4ff' },
  { name: 'Venus Aerospace',       slug: 'venusaero',              api: 'lever',      color: '#ea80fc' },
];

const MAX_DISPLAY = 500;
const NEW_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let allJobs = [];
let activeCompanies = new Set();
let activeDepts     = new Set();
let activeLocations = new Set();
let sourceErrors    = {};
let lastFetched     = null;
let lastFetchedInterval = null;

// ── Color utility ─────────────────────────────────────────────────────────
function isLightColor(hex) {
  // True when dark text (#0a0c10) has better WCAG contrast on this colour than white.
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(parseInt(hex.slice(1,3), 16))
          + 0.7152 * lin(parseInt(hex.slice(3,5), 16))
          + 0.0722 * lin(parseInt(hex.slice(5,7), 16));
  const DARK_L = 0.0037; // luminance of #0a0c10
  return (L + 0.05) / (DARK_L + 0.05) > 1.05 / (L + 0.05);
}

// ── Normalize API responses to common shape ───────────────────────────────
function normalizeGreenhouse(data, source) {
  return (data.jobs || []).map(j => ({
    id:          `gh-${j.id}`,
    title:       j.title || '',
    location:    j.location?.name || '',
    department:  (j.departments || []).map(d => d.name).filter(Boolean).join(', '),
    url:         safeUrl(j.absolute_url),
    publishedAt: j.first_published || null,
    updatedAt:   j.updated_at || null,
    _company: source.name,
    _color:   source.color,
    _api:     'greenhouse',
  }));
}

function normalizeLever(data, source) {
  return (Array.isArray(data) ? data : []).map(j => {
    const ts = j.createdAt ? new Date(j.createdAt).toISOString() : null;
    return {
      id:          `lv-${j.id}`,
      title:       j.text || '',
      location:    j.categories?.location || '',
      department:  j.categories?.team || j.categories?.department || '',
      url:         safeUrl(j.hostedUrl || j.applyUrl),
      publishedAt: ts,
      updatedAt:   ts,
      _company: source.name,
      _color:   source.color,
      _api:     'lever',
    };
  });
}

// ── Fetch ─────────────────────────────────────────────────────────────────
async function fetchSource(source) {
  const url = source.api === 'greenhouse'
    ? `https://boards-api.greenhouse.io/v1/boards/${source.slug}/jobs`
    : `https://api.lever.co/v0/postings/${source.slug}?mode=json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return source.api === 'greenhouse'
    ? normalizeGreenhouse(data, source)
    : normalizeLever(data, source);
}

async function loadJobs() {
  setLoading(true);
  sourceErrors = {};
  activeCompanies.clear();
  activeDepts.clear();
  activeLocations.clear();

  const results = await Promise.allSettled(SOURCES.map(s => fetchSource(s)));

  allJobs = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') {
      allJobs.push(...results[i].value);
    } else {
      sourceErrors[SOURCES[i].name] = results[i].reason?.message || 'Unknown error';
    }
  }

  // Sort newest first; mark jobs < 7 days old
  const now = Date.now();
  allJobs.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  allJobs.forEach(j => { j.isNew = !!(j.publishedAt && now - new Date(j.publishedAt) < NEW_THRESHOLD_MS); });

  // Pre-compute expensive per-job data once so render() and filterJobs() are cheap
  allJobs.forEach(j => {
    j._locParts = splitLocations(j.location).map(l => normalizeLocation(l));
    const newBadge = j.isNew ? `<span class="new-badge">New</span>` : '';
    const deptHtml = j.department ? `<div class="job-dept">${escHtml(j.department)}</div>` : '';
    j._cardInner = `
      <div class="card-header">
        <div class="card-header-left">
          <div class="job-title">${escHtml(j.title)}</div>
          ${newBadge}
        </div>
        <span class="company-badge">${escHtml(j._company)}</span>
      </div>
      <div class="job-meta">
        <div class="job-location">${escHtml(j.location || 'Location TBD')}</div>
        ${deptHtml}
      </div>
      <div class="job-dates">${renderDates(j)}</div>
      <div class="job-card-footer">
        ${j.url ? `<a class="view-btn" href="${escHtml(j.url)}" target="_blank" rel="noopener noreferrer">
          View Job &rarr;
        </a>` : ''}
      </div>`;
  });

  lastFetched = new Date();
  clearInterval(lastFetchedInterval);
  lastFetchedInterval = setInterval(updateLastFetchedDisplay, 60000);
  updateLastFetchedDisplay();

  updateSourceCountLabel();
  buildCompanyPills();
  buildDeptPills();
  buildUSLocationPills();
  buildIntlLocationPills();
  renderSourceErrors();
  setLoading(false);
  render();
}

// ── Loading state ─────────────────────────────────────────────────────────
function setLoading(on) {
  const btn = document.getElementById('refresh-btn');
  if (on) {
    document.getElementById('job-container').innerHTML =
      `<div class="state-msg"><div class="spinner"></div>Loading from ${SOURCES.length} sources…</div>`;
    btn.disabled = true;
    btn.textContent = '↻ Loading…';
  } else {
    btn.disabled = false;
    btn.textContent = '↻ Refresh';
  }
}

// ── Last-fetched display ──────────────────────────────────────────────────
function updateLastFetchedDisplay() {
  const el = document.getElementById('last-fetched');
  if (!lastFetched) { el.textContent = ''; return; }
  const sec = Math.floor((Date.now() - lastFetched) / 1000);
  if (sec < 10)        el.textContent = 'Updated just now';
  else if (sec < 60)   el.textContent = `Updated ${sec}s ago`;
  else if (sec < 3600) el.textContent = `Updated ${Math.floor(sec/60)}m ago`;
  else                 el.textContent = `Updated ${Math.floor(sec/3600)}h ago`;
}

function updateSourceCountLabel() {
  const ok = SOURCES.length - Object.keys(sourceErrors).length;
  document.getElementById('source-count-label').textContent =
    `${ok} of ${SOURCES.length} sources · ${allJobs.length.toLocaleString()} jobs`;
}

// ── Source errors banner ──────────────────────────────────────────────────
function renderSourceErrors() {
  const el = document.getElementById('source-errors');
  const names = Object.keys(sourceErrors);
  if (!names.length) { el.classList.remove('visible'); return; }
  el.classList.add('visible');
  el.textContent =
    `⚠ ${names.length} source${names.length > 1 ? 's' : ''} failed to load: ${names.join(', ')}` +
    ` — slugs may have changed. Check the Recruiting Platforms doc.`;
}

// ── Pill factory ──────────────────────────────────────────────────────────
function makePill(text, attrs = {}, active = false) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pill' + (active ? ' active' : '');
  btn.textContent = text;
  for (const [k, v] of Object.entries(attrs)) btn.setAttribute(k, v);
  return btn;
}

// ── Company pills ─────────────────────────────────────────────────────────
function buildCompanyPills() {
  const container = document.getElementById('company-pills');
  container.innerHTML = '';

  const allBtn = makePill('All', { 'data-company': 'all' }, true);
  allBtn.addEventListener('click', () => resetFilter('company'));
  container.appendChild(allBtn);

  for (const src of SOURCES) {
    const failed = !!sourceErrors[src.name];
    const btn = makePill(failed ? `${src.name} ⚠` : src.name, { 'data-company': src.name });
    btn.style.setProperty('--pill-color', src.color);
    btn.style.setProperty('--pill-text-color', isLightColor(src.color) ? '#0a0c10' : '#fff');
    if (failed) { btn.disabled = true; btn.title = `Failed: ${sourceErrors[src.name]}`; }
    btn.addEventListener('click', () => toggleSet(activeCompanies, src.name, btn, 'company'));
    container.appendChild(btn);
  }
}

// ── Department pills ──────────────────────────────────────────────────────
function buildDeptPills() {
  const container = document.getElementById('dept-pills');
  container.innerHTML = '';

  const allBtn = makePill('All', { 'data-dept': 'all' }, true);
  allBtn.addEventListener('click', () => resetFilter('dept'));
  container.appendChild(allBtn);

  // Count dept occurrences, only show those with > 1 job
  const counts = {};
  for (const job of allJobs) {
    (job.department || '').split(',').forEach(d => {
      const t = d.trim();
      if (t) counts[t] = (counts[t] || 0) + 1;
    });
  }

  Object.entries(counts)
    .filter(([, n]) => n > 1)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([dept]) => {
      const btn = makePill(dept, { 'data-dept': dept });
      btn.addEventListener('click', () => toggleSet(activeDepts, dept, btn, 'dept'));
      container.appendChild(btn);
    });
}

// ── Location normalization & pills ────────────────────────────────────────

// State/region group filters. Sentinel values start with "~" to distinguish
// them from individual normalized location strings in activeLocations.
const LOC_STATE_GROUPS = [
  { label: 'California',  sentinel: '~CA',   test: l => /,\s*CA$/.test(l) },
  { label: 'Texas',       sentinel: '~TX',   test: l => /,\s*TX$/.test(l) },
  { label: 'Washington',  sentinel: '~WA',   test: l => /,\s*WA$/.test(l) },
  { label: 'Florida',     sentinel: '~FL',   test: l => /,\s*FL$/.test(l) },
  { label: 'Colorado',    sentinel: '~CO',   test: l => /,\s*CO$/.test(l) },
];

// US state full name → 2-letter code; used to collapse "City, StateName" → "City, ST"
const US_STATES = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
  'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
  'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
  'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
  'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
  'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
  'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
  'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
  'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC',
};
const US_STATE_CODES = new Set(Object.values(US_STATES));

// Split a raw location string on ; | & and the word "or" — NOT bare commas
function splitLocations(raw) {
  if (!raw) return [];
  return raw.split(/\s*[;|&]\s*|\s+or\s+/i).map(s => s.trim()).filter(Boolean);
}

const LOC_RULES = [
  // ── International remotes — must precede the generic Remote rule ───────
  [/(emea|europe|united kingdom|\buk\b|britain|canada|germany|japan|south korea|apac|\basia\b|singapore|australia|france|netherlands|slovenia|india|new zealand|norway|sweden|austria|ireland|poland|latvia|taiwan|china).*\bremote\b|\bremote\b.*(emea|europe|united kingdom|\buk\b|britain|canada|germany|japan|south korea|apac|\basia\b|singapore|australia|france|netherlands|slovenia|india|new zealand|norway|sweden|austria|ireland|poland|latvia|taiwan|china)/i, 'Remote (Intl)'],
  // ── US Remote ─────────────────────────────────────────────────────────
  [/^other\s*-\s*remote$/i,                                              'Remote'],
  [/flexible/i,                                                          'Multiple US Sites'],
  [/\bremote\b/i,                                                        'Remote'],
  // ── Florida ───────────────────────────────────────────────────────────
  [/cape canaveral|kennedy space/i,                                      'Cape Canaveral, FL'],
  [/merritt island/i,                                                    'Merritt Island, FL'],
  [/melbourne,?\s*fl/i,                                                  'Melbourne, FL'],  // before Australia rule
  // ── Texas ─────────────────────────────────────────────────────────────
  [/boca chica|starbase/i,                                               'Starbase, TX'],
  // ── California ────────────────────────────────────────────────────────
  [/long beach/i,                                                        'Long Beach, CA'],
  [/san francisco|sf,\s*ca/i,                                            'San Francisco, CA'],
  [/san diego/i,                                                         'San Diego, CA'],
  [/mojave/i,                                                            'Mojave, CA'],
  [/el segundo/i,                                                        'El Segundo, CA'],
  [/hawthorne/i,                                                         'Hawthorne, CA'],
  [/los angeles/i,                                                       'Los Angeles, CA'],
  [/mountain view/i,                                                     'Mountain View, CA'],
  [/palo alto/i,                                                         'Palo Alto, CA'],
  [/playa vista/i,                                                       'Playa Vista, CA'],
  [/redondo beach/i,                                                     'Redondo Beach, CA'],
  [/aliso viejo/i,                                                       'Aliso Viejo, CA'],
  [/costa mesa/i,                                                        'Costa Mesa, CA'],
  [/santa ana/i,                                                         'Santa Ana, CA'],
  [/irvine/i,                                                            'Irvine, CA'],
  [/foothill ranch/i,                                                    'Foothill Ranch, CA'],
  [/goleta/i,                                                            'Goleta, CA'],
  [/oceanside/i,                                                         'Oceanside, CA'],
  [/pasadena/i,                                                          'Pasadena, CA'],
  [/san jose/i,                                                          'San Jose, CA'],
  [/sunnyvale/i,                                                         'Sunnyvale, CA'],
  [/folsom/i,                                                            'Folsom, CA'],
  [/vandenberg|lompoc/i,                                                 'Vandenberg, CA'],
  // ── Washington state ──────────────────────────────────────────────────
  [/redmond/i,                                                           'Redmond, WA'],
  [/seattle/i,                                                           'Seattle, WA'],
  [/kent,?\s*(wa|washington)/i,                                          'Kent, WA'],
  [/auburn.*wa|auburn.*washington/i,                                     'Auburn, WA'],
  [/moses lake/i,                                                        'Moses Lake, WA'],
  // ── Colorado ──────────────────────────────────────────────────────────
  [/berthoud/i,                                                          'Berthoud, CO'],
  [/colorado springs/i,                                                  'Colorado Springs, CO'],
  [/fort collins/i,                                                      'Fort Collins, CO'],
  // ── Other US ──────────────────────────────────────────────────────────
  [/albuquerque/i,                                                       'Albuquerque, NM'],
  [/stennis/i,                                                           'Stennis Space Center, MS'],
  // ── DC Metro / Northern VA ────────────────────────────────────────────
  [/washington.*d\.?c\.?|district of columbia/i,                        'Washington DC Area'],
  [/\bnorthern\s*va\b/i,                                                 'Washington DC Area'],
  [/arlington.*va|arlington.*virginia/i,                                 'Washington DC Area'],
  [/mclean|reston|chantilly|herndon|woodbridge.*va/i,                   'Washington DC Area'],
  [/wallops|virginia.*island/i,                                          'Wallops Island, VA'],
  // ── New Zealand ───────────────────────────────────────────────────────
  [/new zealand|auckland|christchurch|mahia|waikato|warkworth/i,        'New Zealand'],
  [/,\s*nz$/i,                                                           'New Zealand'],
  // ── Australia ─────────────────────────────────────────────────────────
  [/melbourne.*victoria|victoria.*australia|sydney.*wales|canberra.*australia|perth.*australia|brisbane/i, 'Australia'],
  [/\baustralia\b/i,                                                     'Australia'],
  // ── United Kingdom ────────────────────────────────────────────────────
  [/edinburgh|scotland|llanbedr|\bwales\b|milton keynes|cambridge.*uk/i, 'United Kingdom'],
  [/london.*england|london.*united kingdom/i,                            'United Kingdom'],
  [/\bunited kingdom\b|\buk\b/i,                                         'United Kingdom'],
  // ── Other international ───────────────────────────────────────────────
  [/amsterdam|haarlem|netherlands/i,                                     'Netherlands'],
  [/munich|berlin|germany/i,                                             'Germany'],
  [/\bgraz\b|austria/i,                                                  'Austria'],
  [/barcelona|spain/i,                                                   'Spain'],
  [/\bparis\b|france/i,                                                  'France'],
  [/buenos aires|argentina/i,                                            'Argentina'],
  [/abu dhabi|\buae\b|united arab emirates/i,                           'UAE'],
  [/\bsingapore\b/i,                                                     'Singapore'],
  [/toronto.*can|toronto.*canada/i,                                      'Toronto, Canada'],
  [/\bcanada\b/i,                                                        'Canada'],
  [/hyderabad.*india|\bindia\b/i,                                        'India'],
  [/seoul|south korea|republic of korea/i,                               'South Korea'],
  [/okinawa|tokyo|japan/i,                                               'Japan'],
  [/taipei|taiwan/i,                                                     'Taiwan'],
  [/stockholm|sweden/i,                                                  'Sweden'],
  [/\boslo\b|norway/i,                                                   'Norway'],
  [/\bdublin\b|ireland/i,                                                'Ireland'],
  [/\briga\b|latvia/i,                                                   'Latvia'],
  [/\bwarsaw\b|poland/i,                                                 'Poland'],
  [/ljubljana|slovenia/i,                                                'Slovenia'],
  [/\bbrussels\b|belgium/i,                                              'Belgium'],
  [/middle east/i,                                                       'Middle East'],
];

function normalizeLocation(loc) {
  if (!loc) return '';
  let s = loc.trim();
  // Strip country/region suffixes (comma, space, or dash before "United States"/"USA"/"US")
  s = s.replace(/[,\s\-]+United States\s*$/i, '').trim();
  s = s.replace(/[,\s\-]+USA\s*$/i,           '').trim();
  s = s.replace(/,\s*US\s*$/,                 '').trim();
  // Convert ", Full State Name" → ", ST"  (e.g. "Kent, Washington" → "Kent, WA")
  s = s.replace(/,\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*$/, (_, name) => {
    const code = US_STATES[name];
    return code ? `, ${code}` : `, ${name}`;
  });
  // Bare "US" or "USA" → Remote
  if (/^(US|USA)$/i.test(s)) return 'Remote';
  // Bare state name (e.g. "Colorado" from "Colorado, USA") → Remote (not a city, not useful as a pill)
  if (US_STATES[s]) return 'Remote';
  // Apply LOC_RULES
  for (const [re, label] of LOC_RULES) if (re.test(s)) return label;
  return s;
}

function isUSLocation(loc) {
  if (!loc) return false;
  if (/^remote\s*\(/i.test(loc)) return false;    // Remote (Intl) is not US
  if (/,\s*[A-Z]{2}\b/.test(loc)) return true;    // "City, ST" or multi-city "City, ST City, ST"
  if (loc === 'Remote' || loc === 'Washington DC Area' || loc === 'Multiple US Sites') return true;
  if (US_STATE_CODES.has(loc)) return true;       // bare 2-letter state code
  if (US_STATES[loc]) return true;                // bare state name (defensive)
  if (/^flexible/i.test(loc)) return true;
  return false;
}

function buildUSLocationPills() {
  const container = document.getElementById('us-location-pills');
  container.innerHTML = '';

  const allBtn = makePill('All', { 'data-loc': 'all' }, true);
  allBtn.addEventListener('click', () => resetFilter('loc'));
  container.appendChild(allBtn);

  // Collect US-only normalized locations
  const locs = new Set();
  for (const job of allJobs) {
    for (const t of job._locParts) {
      if (t && isUSLocation(t)) locs.add(t);
    }
  }

  // State group pills
  let addedGroups = 0;
  for (const grp of LOC_STATE_GROUPS.filter(g => g.sentinel !== '~INTL')) {
    if ([...locs].some(l => grp.test(l))) {
      const btn = makePill(grp.label, { 'data-loc': grp.sentinel });
      btn.addEventListener('click', () => toggleSet(activeLocations, grp.sentinel, btn, 'loc'));
      container.appendChild(btn);
      addedGroups++;
    }
  }

  if (addedGroups > 0) {
    const sep = document.createElement('span');
    sep.className = 'pill-sep';
    container.appendChild(sep);
  }

  // Individual US city pills
  [...locs].sort((a, b) => {
    const stA = (a.match(/,\s*([A-Z]{2})$/) || [])[1] || '';
    const stB = (b.match(/,\s*([A-Z]{2})$/) || [])[1] || '';
    if (a === 'Remote' && b !== 'Remote') return 1;
    if (b === 'Remote' && a !== 'Remote') return -1;
    if (stA && !stB) return -1;
    if (stB && !stA) return 1;
    if (stA !== stB) return stA.localeCompare(stB);
    return a.localeCompare(b);
  }).forEach(loc => {
    const btn = makePill(loc, { 'data-loc': loc });
    btn.addEventListener('click', () => toggleSet(activeLocations, loc, btn, 'loc'));
    container.appendChild(btn);
  });
}

function buildIntlLocationPills() {
  const container = document.getElementById('intl-location-pills');
  container.innerHTML = '';

  // Collect non-US normalized locations
  const locs = new Set();
  for (const job of allJobs) {
    for (const t of job._locParts) {
      if (t && !isUSLocation(t)) locs.add(t);
    }
  }

  if (locs.size === 0) {
    container.innerHTML = '<span class="pills-empty">None in current results</span>';
    return;
  }

  [...locs].sort((a, b) => a.localeCompare(b)).forEach(loc => {
    const btn = makePill(loc, { 'data-loc': loc });
    btn.addEventListener('click', () => toggleSet(activeLocations, loc, btn, 'loc'));
    container.appendChild(btn);
  });
}

// ── Filter toggle / reset ─────────────────────────────────────────────────
function toggleSet(set, value, btn, type) {
  if (set.has(value)) { set.delete(value); btn.classList.remove('active'); }
  else                { set.add(value);    btn.classList.add('active'); }
  document.querySelectorAll(`[data-${type}="all"]`).forEach(p => p.classList.toggle('active', set.size === 0));
  render();
}

function resetFilter(type) {
  const set = type === 'company' ? activeCompanies : type === 'dept' ? activeDepts : activeLocations;
  set.clear();
  document.querySelectorAll(`[data-${type}]`).forEach(p => p.classList.remove('active'));
  document.querySelectorAll(`[data-${type}="all"]`).forEach(p => p.classList.add('active'));
  render();
}

// ── Filter jobs ───────────────────────────────────────────────────────────
function filterJobs() {
  const kw = document.getElementById('keyword-input').value.trim().toLowerCase();
  return allJobs.filter(job => {
    if (activeCompanies.size > 0 && !activeCompanies.has(job._company)) return false;
    if (activeDepts.size > 0) {
      const jobDepts = (job.department || '').split(',').map(d => d.trim());
      if (![...activeDepts].some(d => jobDepts.includes(d))) return false;
    }
    if (activeLocations.size > 0) {
      const parts = job._locParts;
      let matches = false;
      for (const al of activeLocations) {
        if (al.startsWith('~')) {
          const grp = LOC_STATE_GROUPS.find(g => g.sentinel === al);
          if (grp && parts.some(p => grp.test(p))) { matches = true; break; }
        } else if (parts.includes(al)) { matches = true; break; }
      }
      if (!matches) return false;
    }
    if (kw) {
      const haystack = `${job.title} ${job.department} ${job.location}`.toLowerCase();
      if (!haystack.includes(kw)) return false;
    }
    return true;
  });
}

// ── Date formatting ───────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function timeAgo(iso) {
  if (!iso) return '';
  const sec = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (sec < 60)          return 'just now';
  if (sec < 3600)        return `${Math.floor(sec/60)}m ago`;
  if (sec < 86400)       return `${Math.floor(sec/3600)}h ago`;
  if (sec < 86400*30)    return `${Math.floor(sec/86400)}d ago`;
  if (sec < 86400*365)   return `${Math.floor(sec/(86400*30))}mo ago`;
  return `${Math.floor(sec/(86400*365))}y ago`;
}

function renderDates(job) {
  const pub = job.publishedAt, upd = job.updatedAt;
  const sameDay = pub && upd && pub.slice(0,10) === upd.slice(0,10);
  if (sameDay || !upd || upd === pub) {
    return `<div class="job-published">⬡ ${fmtDate(pub)} <span class="time-ago">(${timeAgo(pub)})</span></div>`;
  }
  return `
    <div class="job-published">⬡ Published ${fmtDate(pub)} <span class="time-ago">(${timeAgo(pub)})</span></div>
    <div class="job-updated">Updated ${fmtDate(upd)} <span class="time-ago">(${timeAgo(upd)})</span></div>`;
}

// ── Render ────────────────────────────────────────────────────────────────
function render() {
  const filtered = filterJobs();
  const container = document.getElementById('job-container');
  const bar       = document.getElementById('results-bar');

  // Results bar
  const total = filtered.length;
  let barHtml = `<strong>${total.toLocaleString()}</strong> job${total !== 1 ? 's' : ''}`;
  if (total > MAX_DISPLAY) {
    barHtml += ` <span class="truncation-note">(showing first ${MAX_DISPLAY} — use filters to narrow)</span>`;
  }
  if (activeCompanies.size > 0 && activeCompanies.size <= 5) {
    const counts = {};
    filtered.forEach(j => { counts[j._company] = (counts[j._company] || 0) + 1; });
    const breakdown = [...activeCompanies].map(c => `${counts[c] || 0} ${c}`).join(' · ');
    barHtml += `&nbsp; <span class="bar-sep">|</span> &nbsp;${escHtml(breakdown)}`;
  }
  bar.innerHTML = barHtml;

  if (total === 0) {
    container.innerHTML = `<div class="state-msg"><span class="icon">🔭</span>No jobs match your filters.</div>`;
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'job-grid';

  const limit = Math.min(total, MAX_DISPLAY);
  for (let i = 0; i < limit; i++) {
    const job = filtered[i];
    const card = document.createElement('div');
    card.className = 'job-card';
    card.style.setProperty('--company-color', job._color);
    card.innerHTML = job._cardInner;
    grid.appendChild(card);
  }

  container.innerHTML = '';
  container.appendChild(grid);

  if (total > MAX_DISPLAY) {
    const note = document.createElement('div');
    note.className = 'truncation-bar';
    note.textContent = `${(total - MAX_DISPLAY).toLocaleString()} more results — refine your filters to see them`;
    container.appendChild(note);
  }
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Only allow absolute http(s) links from third-party API data — blocks
// javascript:, data: and other dangerous schemes in job URLs.
function safeUrl(raw) {
  if (!raw) return '';
  try {
    const u = new URL(String(raw));
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
  } catch {
    return '';
  }
}

// ── Debounced keyword search ──────────────────────────────────────────────
let debounceTimer;
document.getElementById('keyword-input').addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(render, 200);
});

// ── Init ──────────────────────────────────────────────────────────────────
document.getElementById('refresh-btn').addEventListener('click', loadJobs);
loadJobs();
