# Space Job Board

A two-part project for tracking aerospace job openings:

- **`job_board.html`** — Interactive browser dashboard for Stoke Space, SpaceX, Relativity Space, and Rocket Lab
- **`stoke_job_monitor.py`** — Headless Python script that monitors Stoke Space's board for new postings matching your criteria and logs alerts

---

## job_board.html

A single-file, no-dependency web app. Just open it in any browser — no server or install required.

### Features

- Fetches live job data directly from the [Greenhouse public API](https://boards-api.greenhouse.io) for all four companies in parallel
- Filter by **company** (Stoke Space, SpaceX, Relativity, Rocket Lab), **location**, or **keyword** — all filters compose together
- Jobs sorted by most recently published first
- Each card shows the job title, location, published date with relative age (e.g. `Published Mar 1, 2026 (6 days ago)`), and last updated date if different
- Color-coded by company: Stoke Space (orange), SpaceX (blue), Relativity (purple), Rocket Lab (gold)
- Responsive dark UI — works on desktop and mobile

### Usage

Double-click `job_board.html` to open in your browser, or serve it locally:

```bash
python -m http.server
# then open http://localhost:8000/job_board.html
```

### Companies & API endpoints

| Company | Greenhouse slug |
|---|---|
| Stoke Space | `stokespacetechnologies` |
| SpaceX | `spacex` |
| Relativity Space | `relativity` |
| Rocket Lab | `rocketlab` |

---

## stoke_job_monitor.py

A headless cron script that monitors the Stoke Space Greenhouse board for new job postings matching configurable criteria. Designed to run on a schedule and alert you only when something new appears.

### How it works

1. **Greenhouse API** — Queries `boards-api.greenhouse.io/v1/boards/stokespacetechnologies/jobs`
2. **HTML fallback** — If the API is unavailable, scrapes the careers page directly (no external dependencies)
3. **Deduplication** — Tracks seen job IDs in `data/seen_job_ids.json` so you're only notified about *new* listings
4. **Criteria matching** — A job triggers a notification if **any** of these match:
   - Title contains `"Engineer"`
   - Location contains `"Cape Canaveral"`
   - Department contains `"Engineer"`
5. **Logging** — Every run appended to `data/run_history.log`; matches go to `data/matched_jobs.log`

### Setup

```bash
# No dependencies — uses Python standard library only (3.10+)
python3 stoke_job_monitor.py

# Check output
cat data/run_history.log
cat data/matched_jobs.log
```

### Cron schedule (every 2 hours)

```cron
0 */2 * * * cd /path/to/space-job-board && /usr/bin/python3 stoke_job_monitor.py >> data/cron_output.log 2>&1
```

### Customizing criteria

Edit the `CRITERIA` list near the top of `stoke_job_monitor.py`:

```python
CRITERIA = [
    {"field": "title",      "operator": "contains", "value": "Engineer"},
    {"field": "location",   "operator": "contains", "value": "Cape Canaveral"},
    {"field": "department", "operator": "contains", "value": "Engineer"},
]
```

Fields available: `title`, `location`, `department`. Operator: `contains` (case-insensitive).

### Overriding the data directory

```bash
STOKE_DATA_DIR=/var/lib/stoke_monitor python3 stoke_job_monitor.py
```

---

## Project structure

```
space-job-board/
├── job_board.html          # Browser UI (open directly, no server needed)
├── stoke_job_monitor.py    # Cron-based Stoke Space job alert script
├── requirements.txt        # No external dependencies — stdlib only
└── data/
    ├── seen_job_ids.json   # Dedup store (auto-created)
    ├── matched_jobs.log    # New job alert log
    ├── run_history.log     # Per-run audit log
    └── cron_output.log     # Cron stdout/stderr (if using cron)
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Jobs don't load in browser | Check browser console — likely a network issue or the Greenhouse API is temporarily down |
| `python3: command not found` | Install Python 3.10+ or use the full path in your cron line |
| API returns 404 in Python script | Stoke Space may have changed their Greenhouse board slug — the HTML fallback will activate automatically |
| 0 jobs on HTML scrape | Page structure may have changed — update the regex patterns in `fetch_jobs_via_html()` |
| Permission denied on `data/` | Ensure the user running the cron job has write access to the project directory |
