#!/usr/bin/env python3
"""
Stoke Space Job Board Monitor
==============================
Monitors Stoke Space's Greenhouse job board for new openings matching
user-defined criteria. Uses the Greenhouse public API with a fallback
to HTML scraping if the API is unavailable.

Designed to run via cron on a regular schedule (e.g., every 2 hours).
"""

import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.error import URLError, HTTPError
from urllib.request import urlopen, Request

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Greenhouse public API — board token is "stokespacetechnologies" (not "stokespace")
GREENHOUSE_API_URL = "https://boards-api.greenhouse.io/v1/boards/stokespacetechnologies/jobs"

# Fallback: the rendered careers page (jobs are JS-rendered via Greenhouse embed,
# so this will only work if the page ever embeds static job data)
CAREERS_PAGE_URL = "https://www.stokespace.com/careers/current-openings/"

# Where to store persistent data (seen IDs, logs)
DATA_DIR = Path(os.environ.get("STOKE_DATA_DIR", Path(__file__).resolve().parent / "data"))

SEEN_IDS_FILE = DATA_DIR / "seen_job_ids.json"
MATCH_LOG_FILE = DATA_DIR / "matched_jobs.log"
RUN_LOG_FILE = DATA_DIR / "run_history.log"

# Network settings
MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 10
REQUEST_TIMEOUT_SECONDS = 30


# ---------------------------------------------------------------------------
# Matching criteria — a job matches if ANY criterion is satisfied
# ---------------------------------------------------------------------------

CRITERIA = [
    {"field": "title",      "operator": "contains", "value": "Engineer"},
    {"field": "location",   "operator": "contains", "value": "Cape Canaveral"},
    {"field": "department", "operator": "contains", "value": "Engineer"},
]


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class Job:
    id: str
    title: str
    location: str = ""
    department: str = ""
    url: str = ""
    updated_at: str = ""

    def matches_criteria(self, criteria: list[dict]) -> list[str]:
        """Return list of human-readable reasons this job matched."""
        reasons: list[str] = []
        for c in criteria:
            field_val = getattr(self, c["field"], "")
            target = c["value"]
            if c["operator"] == "contains" and target.lower() in field_val.lower():
                reasons.append(f'{c["field"]} contains "{target}" -> "{field_val}"')
        return reasons


# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------

def setup_logging() -> logging.Logger:
    logger = logging.getLogger("stoke_monitor")
    logger.setLevel(logging.DEBUG)

    # Console handler — INFO and above
    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.INFO)
    ch.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s"))
    logger.addHandler(ch)

    # File handler — DEBUG and above
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    fh = logging.FileHandler(RUN_LOG_FILE, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s"))
    logger.addHandler(fh)

    return logger


log = setup_logging()


# ---------------------------------------------------------------------------
# Persistence helpers
# ---------------------------------------------------------------------------

def load_seen_ids() -> dict[str, str]:
    """Load previously seen job IDs. Returns {id: first_seen_timestamp}."""
    if SEEN_IDS_FILE.exists():
        try:
            with open(SEEN_IDS_FILE, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError) as exc:
            log.warning("Could not read seen-IDs file, starting fresh: %s", exc)
    return {}


def save_seen_ids(seen: dict[str, str]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = SEEN_IDS_FILE.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump(seen, f, indent=2)
    tmp.replace(SEEN_IDS_FILE)  # atomic on POSIX


# ---------------------------------------------------------------------------
# HTTP helper with retries
# ---------------------------------------------------------------------------

def fetch_url(url: str, accept: str = "application/json") -> Optional[bytes]:
    """Fetch a URL with retries. Returns bytes or None on failure."""
    headers = {
        "User-Agent": "StokeJobMonitor/1.0 (personal job alert script)",
        "Accept": accept,
    }
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            req = Request(url, headers=headers)
            with urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
                return resp.read()
        except HTTPError as exc:
            log.warning("HTTP %s on attempt %d/%d for %s", exc.code, attempt, MAX_RETRIES, url)
            if exc.code in (404, 403, 410):
                # Not transient — don't retry
                return None
        except (URLError, OSError, TimeoutError) as exc:
            log.warning("Network error on attempt %d/%d: %s", attempt, MAX_RETRIES, exc)

        if attempt < MAX_RETRIES:
            log.info("Retrying in %ds…", RETRY_DELAY_SECONDS)
            time.sleep(RETRY_DELAY_SECONDS)

    log.error("All %d attempts failed for %s", MAX_RETRIES, url)
    return None


# ---------------------------------------------------------------------------
# Source 1: Greenhouse public API
# ---------------------------------------------------------------------------

def fetch_jobs_via_api() -> Optional[list[Job]]:
    """Fetch jobs from the Greenhouse boards API."""
    log.info("Trying Greenhouse API: %s", GREENHOUSE_API_URL)
    raw = fetch_url(GREENHOUSE_API_URL)
    if raw is None:
        return None

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        log.error("Invalid JSON from API: %s", exc)
        return None

    jobs_data = data.get("jobs", [])
    jobs: list[Job] = []
    for item in jobs_data:
        location = ""
        loc_field = item.get("location", {})
        if isinstance(loc_field, dict):
            location = loc_field.get("name", "")
        elif isinstance(loc_field, str):
            location = loc_field

        depts = item.get("departments", [])
        dept_names = ", ".join(d.get("name", "") for d in depts if isinstance(d, dict))

        jobs.append(Job(
            id=str(item.get("id", "")),
            title=item.get("title", ""),
            location=location,
            department=dept_names,
            url=item.get("absolute_url", ""),
            updated_at=item.get("updated_at", ""),
        ))

    log.info("API returned %d jobs", len(jobs))
    return jobs


# ---------------------------------------------------------------------------
# Source 2: HTML scraping fallback (no external deps)
# Note: jobs are rendered by a Greenhouse JS embed, so this will find 0 jobs
# unless Greenhouse ever injects static HTML. Kept as a structural fallback.
# ---------------------------------------------------------------------------

def fetch_jobs_via_html() -> Optional[list[Job]]:
    """
    Scrapes the raw HTML of the careers page.
    Uses only stdlib (re + html parsing).
    Note: if the page renders jobs via JavaScript, this will return 0 results.
    """
    log.info("Falling back to HTML scrape: %s", CAREERS_PAGE_URL)
    raw = fetch_url(CAREERS_PAGE_URL, accept="text/html")
    if raw is None:
        return None

    html = raw.decode("utf-8", errors="replace")

    # Strategy A: look for embedded Greenhouse JSON in <script> tags
    # Greenhouse iframes sometimes inject a JS object with all jobs.
    json_match = re.search(r'\"jobs\"\s*:\s*(\[.*?\])\s*[,}]', html, re.DOTALL)
    if json_match:
        try:
            jobs_data = json.loads(json_match.group(1))
            jobs = []
            for item in jobs_data:
                location = ""
                loc = item.get("location", {})
                if isinstance(loc, dict):
                    location = loc.get("name", "")
                elif isinstance(loc, str):
                    location = loc

                depts = item.get("departments", [])
                dept_names = ", ".join(d.get("name", "") for d in depts if isinstance(d, dict))

                jobs.append(Job(
                    id=str(item.get("id", "")),
                    title=item.get("title", ""),
                    location=location,
                    department=dept_names,
                    url=item.get("absolute_url", ""),
                    updated_at=item.get("updated_at", ""),
                ))
            log.info("HTML (embedded JSON) yielded %d jobs", len(jobs))
            return jobs
        except json.JSONDecodeError:
            log.debug("Embedded JSON parse failed, trying regex patterns")

    # Strategy B: regex extraction from Greenhouse-styled HTML
    # Common pattern: <div class="opening"> with <a href="...?gh_jid=ID">Title</a>
    # and <span class="location">Location</span>
    pattern = re.compile(
        r'<a[^>]*href=["\']([^"\']*(?:gh_jid|jobs)[=/](\d+)[^"\']*)["\'][^>]*>'
        r'\s*(.*?)\s*</a>'
        r'(?:.*?<span[^>]*class=["\'][^"\']*location[^"\']*["\'][^>]*>\s*(.*?)\s*</span>)?',
        re.DOTALL | re.IGNORECASE,
    )

    jobs: list[Job] = []
    for m in pattern.finditer(html):
        url, jid, title, location = m.group(1), m.group(2), m.group(3), m.group(4) or ""
        # Strip HTML tags from captured title/location
        title = re.sub(r"<[^>]+>", "", title).strip()
        location = re.sub(r"<[^>]+>", "", location).strip()
        if jid and title:
            jobs.append(Job(id=jid, title=title, location=location, url=url))

    if jobs:
        log.info("HTML (regex) yielded %d jobs", len(jobs))
        return jobs

    log.warning("HTML scrape found 0 jobs — page structure may have changed")
    return jobs  # empty list, not None (scrape succeeded but found nothing)


# ---------------------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------------------

def fetch_jobs() -> list[Job]:
    """Try Greenhouse API first, fall back to HTML scrape."""
    jobs = fetch_jobs_via_api()
    if jobs is not None:
        return jobs

    log.warning("Greenhouse API unavailable, falling back to HTML scraper")
    jobs = fetch_jobs_via_html()
    if jobs is not None:
        return jobs

    log.error("Both API and HTML scraper failed — no jobs retrieved this run")
    return []


def process_jobs(jobs: list[Job]) -> tuple[list[Job], list[tuple[Job, list[str]]]]:
    """
    Compare fetched jobs against seen IDs and criteria.
    Returns (new_jobs, matched_jobs_with_reasons).
    """
    seen = load_seen_ids()
    now = datetime.now(timezone.utc).isoformat()

    new_jobs: list[Job] = []
    matched: list[tuple[Job, list[str]]] = []

    for job in jobs:
        if job.id in seen:
            continue
        new_jobs.append(job)
        seen[job.id] = now

        reasons = job.matches_criteria(CRITERIA)
        if reasons:
            matched.append((job, reasons))

    save_seen_ids(seen)
    return new_jobs, matched


def notify(matched: list[tuple[Job, list[str]]]) -> None:
    """Print matches to console and append to the match log file."""
    if not matched:
        log.info("No new matching jobs this run.")
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    lines: list[str] = []
    lines.append("")
    lines.append("=" * 72)
    lines.append(f"  *** NEW MATCHING JOBS FOUND -- {timestamp}")
    lines.append("=" * 72)

    for job, reasons in matched:
        lines.append("")
        lines.append(f"  Title:      {job.title}")
        lines.append(f"  ID:         {job.id}")
        lines.append(f"  Location:   {job.location}")
        lines.append(f"  Department: {job.department}")
        lines.append(f"  URL:        {job.url}")
        lines.append(f"  Matched:    {'; '.join(reasons)}")
        lines.append(f"  Updated:    {job.updated_at}")
        lines.append("  " + "-" * 68)

    output = "\n".join(lines)

    # Log file first — so results are never lost if print fails
    with open(MATCH_LOG_FILE, "a", encoding="utf-8") as f:
        f.write(output + "\n")

    # Console
    print(output)


def log_run_summary(total: int, new_count: int, match_count: int, error: str = "") -> None:
    """Append a single-line summary to the run history log."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    status = "ERROR" if error else "OK"
    entry = (
        f"{timestamp}  status={status}  total_jobs={total}  "
        f"new_jobs={new_count}  matches={match_count}"
    )
    if error:
        entry += f"  error={error}"
    with open(RUN_LOG_FILE, "a", encoding="utf-8") as f:
        f.write(entry + "\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    log.info("=" * 50)
    log.info("Stoke Space Job Monitor — run started")
    log.info("=" * 50)

    try:
        jobs = fetch_jobs()
        new_jobs, matched = process_jobs(jobs)

        log.info(
            "Summary: %d total jobs, %d new, %d matching criteria",
            len(jobs), len(new_jobs), len(matched),
        )

        notify(matched)
        log_run_summary(len(jobs), len(new_jobs), len(matched))

    except Exception as exc:
        log.exception("Unexpected error during run")
        log_run_summary(0, 0, 0, error=str(exc))
        sys.exit(1)

    log.info("Run complete.\n")


if __name__ == "__main__":
    main()
