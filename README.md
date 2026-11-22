# Space Industry Job Board

A two-part project for tracking aerospace job openings:

- **`index.html`** — Multi-company live job board deployed to Cloudflare Pages
- **`stoke_job_monitor.py`** — Headless Python cron script that alerts on new Stoke Space postings matching your criteria

---

## index.html — Browser Job Board

A single-file, no-dependency web app. Open it in any browser or deploy to any static host.

### Features

- Fetches live job data in parallel from **Greenhouse** (17 companies) and **Lever** (3 companies)
- **Per-source graceful failure** — if a source fails, the board shows the rest with a warning banner
- Filter by **company**, **department**, **location**, or **keyword** — all filters compose together
- **"New" badge** on jobs posted within the last 7 days
- **Refresh button** with last-updated timestamp
- Jobs sorted by most recently published
- Color-coded per company using a dynamic CSS variable system
- Responsive dark UI

### Search engines & security

Static files deployed with the board (all at the repo root, which is the Cloudflare Pages output directory):

| File | Purpose |
|---|---|
| `app.js`, `styles.css` | Board logic and styles, kept out of `index.html` so a strict CSP can forbid inline scripts |
| `_headers` | Security headers (CSP, HSTS, nosniff, frame/referrer/permissions policies) and `noindex` for non-site repo files |
| `robots.txt`, `sitemap.xml` | Crawl rules and sitemap for Google |
| `404.html` | Real 404 page (without it Cloudflare Pages serves `index.html` for every path, creating "soft 404s") |
| `favicon.svg` | Site icon shown in search results |

The site URL `https://space-job-board.pages.dev` is used in `index.html` (canonical, Open Graph, JSON-LD), `robots.txt` and `sitemap.xml`. If you use a custom domain, replace it in all three.

If you add a new job source on a different host, add that host to `connect-src` in `_headers` or its requests will be blocked.

### Serving locally

```bash
python -m http.server
# open http://localhost:8000
```

### Companies covered

#### Greenhouse
| Company | Slug | Status |
|---|---|---|
| Stoke Space | `stokespacetechnologies` | Confirmed |
| SpaceX | `spacex` | Confirmed |
| Relativity Space | `relativity` | Confirmed |
| Rocket Lab | `rocketlab` | Confirmed |
| Inversion Space | `inversionspace` | Confirmed |
| Varda Space | `vardaspace` | Confirmed |
| Vast Space | `vast` | Likely |
| Astranis | `astranis` | Likely |
| Muon Space | `muonspace` | Likely |
| Albedo | `albedo` | Likely |
| True Anomaly | `trueanomaly` | Likely |
| Ursa Major | `ursamajor` | Likely |
| AST SpaceMobile | `astspacemobile` | Likely |
| Anduril | `anduril` | Likely |
| Voyager Space | `voyagerspace` | Likely |
| Planet Labs | `planetlabs` | Likely |
| BlackSky | `blacksky` | Likely |

#### Lever
| Company | Slug |
|---|---|
| Hermeus | `hermeus` |
| CesiumAstro | `CesiumAstro` |
| Venus Aerospace | `venusaerospace` |

If a source fails to load (shown in the warning banner), its Greenhouse/Lever slug may have changed. See `Space Companies - Recruiting Platforms.md` to look up the correct slug and update `SOURCES` in `app.js`.

---

## stoke_job_monitor.py — Cron Alert Script

Monitors Stoke Space's Greenhouse board for new postings matching configurable criteria. Tracks removals too.

### Usage

```bash
python3 stoke_job_monitor.py                # normal run
python3 stoke_job_monitor.py --dry-run      # check without updating state files
python3 stoke_job_monitor.py --reset        # clear seen IDs, re-alert on all current jobs
```

### How it works

1. Queries `boards-api.greenhouse.io/v1/boards/stokespacetechnologies/jobs`
2. **New jobs** — compares against `data/seen_job_ids.json`; alerts if criteria match
3. **Removed jobs** — compares against previous run's cache (`data/last_run_ids.json`)
4. Writes matches and removals to `data/matched_jobs.log`
5. Optionally POSTs to a webhook

### Criteria (edit to change)

```python
CRITERIA = [
    {"field": "title",      "operator": "contains", "value": "Engineer"},
    {"field": "location",   "operator": "contains", "value": "Cape Canaveral"},
    {"field": "department", "operator": "contains", "value": "Engineer"},
]
```

A job alerts if **any** criterion matches. Fields: `title`, `location`, `department`.

### Webhook notifications

Set `WEBHOOK_URL` env var to receive alerts:

```bash
# Discord
WEBHOOK_URL="https://discord.com/api/webhooks/..." python3 stoke_job_monitor.py

# ntfy / Slack / generic (receives JSON payload)
WEBHOOK_URL="https://ntfy.sh/your-topic" python3 stoke_job_monitor.py
```

Discord webhooks are auto-detected and formatted as embeds. All others receive a generic JSON payload.

### Cron schedule (every 2 hours)

```cron
0 */2 * * * cd /path/to/space-job-board && /usr/bin/python3 stoke_job_monitor.py >> data/cron_output.log 2>&1
```

### Override data directory

```bash
STOKE_DATA_DIR=/var/lib/stoke_monitor python3 stoke_job_monitor.py
```

---

## Project structure

```
space-job-board/
├── index.html                              # Browser job board (Cloudflare Pages)
├── app.js / styles.css                     # Board script and styles
├── _headers, robots.txt, sitemap.xml, 404.html, favicon.svg  # Hosting, SEO & security
├── stoke_job_monitor.py                    # Cron alert script
├── Space Companies.txt                     # 56-company research list
├── Space Companies - Recruiting Platforms.md  # ATS platform research
└── data/
    ├── seen_job_ids.json                   # Dedup store (auto-created)
    ├── last_run_ids.json                   # Previous run job cache (for removal detection)
    ├── matched_jobs.log                    # New job + removal alert log
    ├── run_history.log                     # Per-run audit log
    └── cron_output.log                     # Cron stdout/stderr
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Jobs don't load / source error banner | Check browser console — slug may have changed. Look up correct slug in `Space Companies - Recruiting Platforms.md` and update `SOURCES` in `app.js` |
| `python3: command not found` | Install Python 3.10+ or use the full path in your cron line |
| API returns 404 in monitor script | Update `GREENHOUSE_API_URL` slug in `stoke_job_monitor.py` |
| Want to re-alert on all current jobs | Run `python3 stoke_job_monitor.py --reset` |
| Test without changing state | Run `python3 stoke_job_monitor.py --dry-run` |
