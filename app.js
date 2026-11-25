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


// ── Location normalization ───────────────────────────────────────────────

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


// ── UI state ──────────────────────────────────────────────────────────────
const PAGE_SIZE = 60;
const NEW_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SORTS = {
  newest:  (a, b) => b._ts - a._ts,
  oldest:  (a, b) => a._ts - b._ts,
  company: (a, b) => a._company.localeCompare(b._company) || b._ts - a._ts,
  title:   (a, b) => a.title.localeCompare(b.title) || b._ts - a._ts,
};

const state = {
  q: '',
  newOnly: false,
  sort: 'newest',
  shown: PAGE_SIZE,
  sets: { company: new Set(), dept: new Set(), loc: new Set() },
};

// Filter dropdowns. `param` is the URL query parameter used for sharing links.
const FACETS = {
  company: { param: 'company',  options: [] },
  dept:    { param: 'dept',     options: [] },
  loc:     { param: 'location', options: [] },
};

let allJobs = [];
let sourceErrors = {};
let lastFetched = null;
let lastFetchedTimer = null;
let loading = false;

const $ = id => document.getElementById(id);
const LOC_GROUP = Object.fromEntries(LOC_STATE_GROUPS.map(g => [g.sentinel, g]));

// ── Fetch & prepare jobs ──────────────────────────────────────────────────
async function loadJobs() {
  if (loading) return;
  loading = true;
  setRefreshing(true);
  showSkeleton();

  const results = await Promise.allSettled(SOURCES.map(s => fetchSource(s)));

  allJobs = [];
  sourceErrors = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      allJobs.push(...r.value);
    } else {
      sourceErrors[SOURCES[i].name] = r.reason?.message || 'Unknown error';
      // Developer hint: a failing source usually means its ATS slug changed.
      console.warn(`[jobs] ${SOURCES[i].name} (${SOURCES[i].api}/${SOURCES[i].slug}) failed:`, sourceErrors[SOURCES[i].name]);
    }
  });

  const now = Date.now();
  for (const j of allJobs) {
    j._ts       = Date.parse(j.publishedAt) || 0;
    j.isNew     = !!(j._ts && now - j._ts < NEW_THRESHOLD_MS);
    j._locParts = splitLocations(j.location).map(l => normalizeLocation(l));
    j._depts    = (j.department || '').split(',').map(d => d.trim()).filter(Boolean);
    j._hay      = `${j.title} ${j._company} ${j.department} ${j.location}`.toLowerCase();
    j._cardHtml = cardHtml(j);
  }

  lastFetched = new Date();
  clearInterval(lastFetchedTimer);
  lastFetchedTimer = setInterval(updateLastFetched, 30000);
  updateLastFetched();

  buildFacetOptions();
  sanitizeState();
  renderStats();
  renderNotice();
  loading = false;
  setRefreshing(false);

  if (!allJobs.length) { showLoadError(); return; }
  render();
}

function cardHtml(j) {
  const title = escHtml(j.title || 'Untitled role');
  const titleHtml = j.url
    ? `<a class="job-link" href="${escHtml(j.url)}" target="_blank" rel="noopener noreferrer">${title}<span class="sr-only"> at ${escHtml(j._company)} (opens in a new tab)</span></a>`
    : title;
  const posted = j._ts
    ? `<span class="posted" title="${escHtml(fmtDate(j.publishedAt))}">Posted ${escHtml(timeAgo(j.publishedAt))}</span>`
    : `<span class="posted">Date not listed</span>`;
  const dept = j.department
    ? `<li><svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5h12v8H2zM6 5V3h4v2"/></svg><span>${escHtml(j.department)}</span></li>`
    : '';
  return `
    <div class="card-top">
      <span class="company"><span class="dot" aria-hidden="true"></span>${escHtml(j._company)}</span>
      ${j.isNew ? '<span class="new-badge">New</span>' : ''}
    </div>
    <h3 class="job-title">${titleHtml}</h3>
    <ul class="job-meta">
      <li><svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 15s5-4.6 5-8.5A5 5 0 0 0 3 6.5C3 10.4 8 15 8 15z"/><circle cx="8" cy="6.5" r="1.8"/></svg><span>${escHtml(j.location || 'Location not listed')}</span></li>
      ${dept}
    </ul>
    <div class="card-foot">
      ${posted}
      ${j.url ? '<span class="apply" aria-hidden="true">View &amp; apply&nbsp;↗</span>' : ''}
    </div>`;
}

// ── Filtering ─────────────────────────────────────────────────────────────
function matchesFacet(job, key) {
  const set = state.sets[key];
  if (!set.size) return true;
  if (key === 'company') return set.has(job._company);
  if (key === 'dept')    return job._depts.some(d => set.has(d));
  for (const v of set) {
    if (v.startsWith('~')) {
      const g = LOC_GROUP[v];
      if (g && job._locParts.some(p => g.test(p))) return true;
    } else if (job._locParts.includes(v)) return true;
  }
  return false;
}

function queryTerms() {
  return state.q.toLowerCase().split(/\s+/).filter(Boolean);
}

// `except` skips one facet — used to compute "how many jobs would this option give".
function jobMatches(job, terms, except = null) {
  if (state.newOnly && !job.isNew) return false;
  for (const key of Object.keys(FACETS)) {
    if (key !== except && !matchesFacet(job, key)) return false;
  }
  return terms.every(t => job._hay.includes(t));
}

function facetValues(job, key) {
  if (key === 'company') return [job._company];
  if (key === 'dept') return job._depts;
  const vals = new Set(job._locParts.filter(Boolean));
  for (const g of LOC_STATE_GROUPS) if (job._locParts.some(p => g.test(p))) vals.add(g.sentinel);
  return vals;
}

// ── Facet dropdowns ───────────────────────────────────────────────────────
function buildFacetOptions() {
  // Company
  FACETS.company.options = [...SOURCES]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(s => ({ value: s.name, label: s.name, color: s.color, disabled: !!sourceErrors[s.name] }));

  // Department
  const depts = new Set();
  allJobs.forEach(j => j._depts.forEach(d => depts.add(d)));
  FACETS.dept.options = [...depts].sort((a, b) => a.localeCompare(b)).map(d => ({ value: d, label: d }));

  // Location: state groups, US places, then international
  const us = new Set(), intl = new Set();
  allJobs.forEach(j => j._locParts.forEach(l => { if (l) (isUSLocation(l) ? us : intl).add(l); }));
  const usSorted = [...us].sort((a, b) => (a === 'Remote' ? -1 : b === 'Remote' ? 1 : a.localeCompare(b)));
  FACETS.loc.options = [
    ...LOC_STATE_GROUPS.filter(g => [...us].some(l => g.test(l)))
      .map(g => ({ value: g.sentinel, label: `${g.label} (all)`, section: 'US states' })),
    ...usSorted.map(l => ({ value: l, label: l, section: 'United States' })),
    ...[...intl].sort((a, b) => a.localeCompare(b)).map(l => ({ value: l, label: l, section: 'Outside the US' })),
  ];

  for (const key of Object.keys(FACETS)) renderFacetList(key);
  $('toggle-remote').disabled = !FACETS.loc.options.some(o => o.value === 'Remote');
}

function renderFacetList(key) {
  const list = document.querySelector(`.dd[data-facet="${key}"] .dd-list`);
  list.textContent = '';
  let section = null;
  for (const opt of FACETS[key].options) {
    if (opt.section && opt.section !== section) {
      section = opt.section;
      const h = document.createElement('div');
      h.className = 'opt-section';
      h.textContent = section;
      list.appendChild(h);
    }
    const label = document.createElement('label');
    label.className = 'opt';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = opt.value;
    input.disabled = !!opt.disabled;
    input.addEventListener('change', () => toggleValue(key, opt.value, input.checked));
    label.appendChild(input);
    if (opt.color) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.setProperty('--dot', opt.color);
      label.appendChild(dot);
    }
    const name = document.createElement('span');
    name.className = 'opt-name';
    name.textContent = opt.label;
    const count = document.createElement('span');
    count.className = 'opt-count';
    if (opt.disabled) count.textContent = 'unavailable';
    label.append(name, count);
    list.appendChild(label);
    Object.assign(opt, { el: label, input, countEl: count, search: opt.label.toLowerCase() });
  }
  if (!FACETS[key].options.length) {
    const empty = document.createElement('div');
    empty.className = 'opt-empty';
    empty.textContent = 'Nothing to filter yet';
    list.appendChild(empty);
  }
}

function updateFacetCounts(terms) {
  for (const key of Object.keys(FACETS)) {
    const counts = new Map();
    for (const job of allJobs) {
      if (!jobMatches(job, terms, key)) continue;
      for (const v of facetValues(job, key)) counts.set(v, (counts.get(v) || 0) + 1);
    }
    const set = state.sets[key];
    for (const opt of FACETS[key].options) {
      if (!opt.el) continue;
      const n = counts.get(opt.value) || 0;
      opt.input.checked = set.has(opt.value);
      if (!opt.disabled) opt.countEl.textContent = n.toLocaleString();
      opt.el.classList.toggle('zero', n === 0 && !set.has(opt.value));
    }
    const badge = document.querySelector(`.dd[data-facet="${key}"] .dd-badge`);
    badge.textContent = set.size;
    badge.hidden = set.size === 0;
  }
}

function filterOptionList(key, text) {
  const t = text.trim().toLowerCase();
  const dd = document.querySelector(`.dd[data-facet="${key}"]`);
  let visible = 0;
  for (const opt of FACETS[key].options) {
    if (!opt.el) continue;
    const show = !t || opt.search.includes(t);
    opt.el.hidden = !show;
    if (show) visible++;
  }
  // Hide section headings with nothing under them
  dd.querySelectorAll('.opt-section').forEach(h => {
    let n = h.nextElementSibling, any = false;
    while (n && !n.classList.contains('opt-section')) { if (!n.hidden) any = true; n = n.nextElementSibling; }
    h.hidden = !any;
  });
  dd.querySelector('.dd-nomatch').hidden = visible > 0 || !FACETS[key].options.length;
}

function openDropdown(dd) {
  closeDropdowns(dd);
  dd.querySelector('.dd-panel').hidden = false;
  dd.querySelector('.dd-btn').setAttribute('aria-expanded', 'true');
  document.body.classList.add('dd-open');
  if (matchMedia('(pointer: fine)').matches) dd.querySelector('.dd-search').focus();
}

function closeDropdowns(except = null) {
  document.querySelectorAll('.dd').forEach(dd => {
    if (dd === except) return;
    const panel = dd.querySelector('.dd-panel');
    if (panel.hidden) return;
    panel.hidden = true;
    dd.querySelector('.dd-btn').setAttribute('aria-expanded', 'false');
    const search = dd.querySelector('.dd-search');
    search.value = '';
    filterOptionList(dd.dataset.facet, '');
  });
  if (!except) document.body.classList.remove('dd-open');
}

// ── State changes ─────────────────────────────────────────────────────────
function changed() {
  state.shown = PAGE_SIZE;
  render();
}

function toggleValue(key, value, on) {
  if (on) state.sets[key].add(value); else state.sets[key].delete(value);
  changed();
}

function clearAll() {
  state.q = '';
  $('search').value = '';
  state.newOnly = false;
  Object.values(state.sets).forEach(s => s.clear());
  changed();
}

// ── URL sync (shareable, survives reload) ─────────────────────────────────
function readUrl() {
  const p = new URLSearchParams(location.search);
  state.q = (p.get('q') || '').slice(0, 200);
  state.newOnly = p.get('new') === '1';
  state.sort = SORTS[p.get('sort')] ? p.get('sort') : 'newest';
  for (const [key, f] of Object.entries(FACETS)) {
    state.sets[key] = new Set(p.getAll(f.param).slice(0, 100));
  }
  $('search').value = state.q;
  $('sort').value = state.sort;
}

function writeUrl() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.newOnly) p.set('new', '1');
  if (state.sort !== 'newest') p.set('sort', state.sort);
  for (const [key, f] of Object.entries(FACETS)) state.sets[key].forEach(v => p.append(f.param, v));
  const qs = p.toString();
  const url = location.pathname + (qs ? `?${qs}` : '');
  if (url !== location.pathname + location.search) history.replaceState(null, '', url);
}

// Drop filter values from the URL that don't exist in the loaded data.
function sanitizeState() {
  for (const key of Object.keys(FACETS)) {
    const valid = new Set(FACETS[key].options.filter(o => !o.disabled).map(o => o.value));
    for (const v of [...state.sets[key]]) if (!valid.has(v)) state.sets[key].delete(v);
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────
function render() {
  const terms = queryTerms();
  const filtered = allJobs.filter(j => jobMatches(j, terms));
  filtered.sort(SORTS[state.sort]);

  updateFacetCounts(terms);
  renderControls();
  renderChips();
  writeUrl();

  const total = filtered.length;
  $('result-count').textContent = loading ? '' :
    `${total.toLocaleString()} ${total === 1 ? 'job' : 'jobs'}${hasFilters() ? ' match your filters' : ''}`;

  const container = $('job-container');
  container.textContent = '';
  $('more-wrap').hidden = true;

  if (!total) {
    container.appendChild(stateMessage(
      'No jobs match your filters',
      'Try removing a filter or searching for something broader.',
      hasFilters() ? { label: 'Clear all filters', onClick: clearAll } : null));
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'job-grid';
  const limit = Math.min(total, state.shown);
  for (let i = 0; i < limit; i++) {
    const job = filtered[i];
    const card = document.createElement('article');
    card.className = 'job-card' + (job.url ? ' clickable' : '');
    card.style.setProperty('--company-color', job._color);
    card.innerHTML = job._cardHtml;
    grid.appendChild(card);
  }
  container.appendChild(grid);

  if (total > limit) {
    const remaining = total - limit;
    $('more-btn').textContent = `Show ${Math.min(PAGE_SIZE, remaining)} more`;
    $('more-note').textContent = `Showing ${limit.toLocaleString()} of ${total.toLocaleString()}`;
    $('more-wrap').hidden = false;
  }
}

function hasFilters() {
  return !!state.q.trim() || state.newOnly || Object.values(state.sets).some(s => s.size);
}

function renderControls() {
  $('toggle-new').setAttribute('aria-pressed', String(state.newOnly));
  $('toggle-remote').setAttribute('aria-pressed', String(state.sets.loc.has('Remote')));
  $('search-clear').hidden = !state.q;
}

function renderChips() {
  const wrap = $('active-filters');
  const list = $('chip-list');
  list.textContent = '';
  const add = (text, remove) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('aria-label', `Remove filter: ${text}`);
    b.textContent = text;
    const x = document.createElement('span');
    x.className = 'chip-x';
    x.setAttribute('aria-hidden', 'true');
    x.textContent = '×';
    b.appendChild(x);
    b.addEventListener('click', () => { remove(); changed(); });
    list.appendChild(b);
  };
  if (state.q.trim()) add(`“${state.q.trim()}”`, () => { state.q = ''; $('search').value = ''; });
  if (state.newOnly) add('New this week', () => { state.newOnly = false; });
  for (const [key, set] of Object.entries(state.sets)) {
    for (const v of set) {
      const label = FACETS[key].options.find(o => o.value === v)?.label || v;
      add(label, () => set.delete(v));
    }
  }
  wrap.hidden = !list.children.length;
}

function renderStats() {
  const ok = SOURCES.length - Object.keys(sourceErrors).length;
  const el = $('stats');
  el.textContent = '';
  const strong = t => { const s = document.createElement('strong'); s.textContent = t; return s; };
  el.append(strong(allJobs.length.toLocaleString()), ' open roles at ', strong(String(ok)), ' companies');
}

function renderNotice() {
  const names = Object.keys(sourceErrors);
  const el = $('notice');
  if (!names.length || !allJobs.length) { el.hidden = true; return; }
  const list = names.length <= 3 ? names.join(', ').replace(/, ([^,]*)$/, ' and $1') : `${names.length} companies`;
  $('notice-text').textContent = `Couldn't load jobs from ${list} right now. Showing everything else.`;
  el.hidden = false;
}

function updateLastFetched() {
  const el = $('last-fetched');
  if (!lastFetched) { el.textContent = ''; return; }
  const sec = Math.floor((Date.now() - lastFetched) / 1000);
  el.textContent = sec < 60 ? 'Updated just now'
    : sec < 3600 ? `Updated ${Math.floor(sec / 60)} min ago`
    : `Updated ${Math.floor(sec / 3600)} h ago`;
}

function setRefreshing(on) {
  const btn = $('refresh-btn');
  btn.disabled = on;
  btn.classList.toggle('spinning', on);
  if (on) $('last-fetched').textContent = 'Loading jobs…';
}

function showSkeleton() {
  const container = $('job-container');
  container.textContent = '';
  $('more-wrap').hidden = true;
  $('result-count').textContent = 'Loading jobs…';
  const grid = document.createElement('div');
  grid.className = 'job-grid';
  grid.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 6; i++) {
    const c = document.createElement('div');
    c.className = 'job-card skeleton';
    c.innerHTML = '<div class="sk sk-s"></div><div class="sk sk-l"></div><div class="sk sk-m"></div><div class="sk sk-s"></div>';
    grid.appendChild(c);
  }
  container.appendChild(grid);
}

function showLoadError() {
  $('result-count').textContent = '';
  const c = $('job-container');
  c.textContent = '';
  c.appendChild(stateMessage(
    "We couldn't load any jobs",
    'Check your internet connection and try again.',
    { label: 'Try again', onClick: loadJobs }));
}

function stateMessage(title, text, action) {
  const box = document.createElement('div');
  box.className = 'state-msg';
  const h = document.createElement('h2');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = text;
  box.append(h, p);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-primary';
    b.textContent = action.label;
    b.addEventListener('click', action.onClick);
    box.appendChild(b);
  }
  return box;
}

// ── Events ────────────────────────────────────────────────────────────────
let searchTimer;
$('search').addEventListener('input', e => {
  state.q = e.target.value;
  $('search-clear').hidden = !state.q;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(changed, 150);
});
$('search-form').addEventListener('submit', e => { e.preventDefault(); clearTimeout(searchTimer); changed(); });
$('search-clear').addEventListener('click', () => {
  state.q = '';
  $('search').value = '';
  $('search').focus();
  changed();
});

$('sort').addEventListener('change', e => { state.sort = e.target.value; changed(); });
$('toggle-new').addEventListener('click', () => { state.newOnly = !state.newOnly; changed(); });
$('toggle-remote').addEventListener('click', () => {
  const s = state.sets.loc;
  if (s.has('Remote')) s.delete('Remote'); else s.add('Remote');
  changed();
});
$('clear-all').addEventListener('click', clearAll);
$('more-btn').addEventListener('click', () => {
  state.shown += PAGE_SIZE;
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
});
$('refresh-btn').addEventListener('click', loadJobs);
$('notice-close').addEventListener('click', () => { $('notice').hidden = true; });

document.querySelectorAll('.dd').forEach(dd => {
  const key = dd.dataset.facet;
  dd.querySelector('.dd-btn').addEventListener('click', () => {
    if (dd.querySelector('.dd-panel').hidden) openDropdown(dd); else closeDropdowns();
  });
  dd.querySelector('.dd-search').addEventListener('input', e => filterOptionList(key, e.target.value));
  dd.querySelector('.dd-clear').addEventListener('click', () => { state.sets[key].clear(); changed(); });
  dd.querySelector('.dd-done').addEventListener('click', () => { closeDropdowns(); dd.querySelector('.dd-btn').focus(); });
});
$('dd-backdrop').addEventListener('click', () => closeDropdowns());

document.addEventListener('click', e => { if (!e.target.closest('.dd')) closeDropdowns(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const open = [...document.querySelectorAll('.dd')].find(dd => !dd.querySelector('.dd-panel').hidden);
    if (open) { closeDropdowns(); open.querySelector('.dd-btn').focus(); }
    return;
  }
  // "/" jumps to search, like many sites
  if (e.key === '/' && !e.target.closest('input, select, textarea')) {
    e.preventDefault();
    $('search').focus();
  }
});

// ── Init ──────────────────────────────────────────────────────────────────
readUrl();
loadJobs();
