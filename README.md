# Stoke Space Job Board Monitor

Monitors [Stoke Space's career page](https://www.stokespace.com/careers/current-openings/) for new job openings matching your criteria, and alerts you via console output and a local log file.

## How It Works

1. **Greenhouse API first** — Queries `boards-api.greenhouse.io/v1/boards/stokespace/jobs` (fast, reliable, structured JSON).
2. **HTML fallback** — If the API is down, scrapes the careers page directly using regex patterns (no browser required).
3. **Deduplication** — Tracks seen job IDs in `data/seen_job_ids.json` so you're only notified about *new* listings.
4. **Criteria matching** — A job triggers a notification if **any** of these are true:
   - Title contains **"Engineer"**
   - Location contains **"Cape Canaveral"**
   - Department contains **"Engineer"**
5. **Logging** — Every run is logged to `data/run_history.log`; matches go to `data/matched_jobs.log`.

## Setup

```bash
# 1. Clone or copy the project
cd stoke_scraper/

# 2. No pip install needed — uses only Python standard library (3.10+)
#    Verify your Python version:
python3 --version

# 3. Test it manually
python3 stoke_job_monitor.py

# 4. Check the output
cat data/run_history.log
cat data/matched_jobs.log
```

## Cron Schedule (every 2 hours)

Add this line to your crontab (`crontab -e`):

```cron
0 */2 * * * cd /path/to/stoke_scraper && /usr/bin/python3 stoke_job_monitor.py >> data/cron_output.log 2>&1
```

Replace `/path/to/stoke_scraper` with the actual directory path.

**Tip:** To test first, run every 5 minutes temporarily:
```cron
*/5 * * * * cd /path/to/stoke_scraper && /usr/bin/python3 stoke_job_monitor.py >> data/cron_output.log 2>&1
```

## Project Structure

```
stoke_scraper/
├── stoke_job_monitor.py    # Main script
├── requirements.txt        # Dependencies (stdlib only — nothing to install)
├── README.md               # This file
└── data/                   # Created automatically on first run
    ├── seen_job_ids.json   # Persistent dedup store
    ├── matched_jobs.log    # Matched job notifications
    ├── run_history.log     # One-line-per-run audit log
    └── cron_output.log     # Stdout/stderr from cron (if using the cron line above)
```

## Customizing Criteria

Edit the `CRITERIA` list near the top of `stoke_job_monitor.py`:

```python
CRITERIA = [
    {"field": "title",      "operator": "contains", "value": "Engineer"},
    {"field": "location",   "operator": "contains", "value": "Cape Canaveral"},
    {"field": "department", "operator": "contains", "value": "Engineer"},
]
```

Each entry matches against the `title`, `location`, or `department` field using case-insensitive substring search. A job triggers a notification if **any** criterion matches.

## Overriding the Data Directory

Set the `STOKE_DATA_DIR` environment variable to store data elsewhere:

```bash
STOKE_DATA_DIR=/var/lib/stoke_monitor python3 stoke_job_monitor.py
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `python3: command not found` | Install Python 3.10+ or adjust the cron line to your Python path |
| API returns 404 | Stoke Space may have changed their Greenhouse board token — the HTML fallback will kick in automatically |
| 0 jobs found on HTML scrape | The page structure likely changed — open an issue or update the regex patterns in `fetch_jobs_via_html()` |
| Permission denied on data/ | Ensure the cron user has write access to the project directory |
