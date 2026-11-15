#!/usr/bin/env python3
"""
Stoke Space Job Board Monitor
==============================
Monitors Stoke Space's Greenhouse job board for new openings matching
user-defined criteria. Designed to run via cron on a regular schedule.

Usage:
    python3 stoke_job_monitor.py
    python3 stoke_job_monitor.py --dry-run   # check without updating state
    python3 stoke_job_monitor.py --reset     # clear seen IDs and re-alert all
"""

import argparse
import json
import logging
import os
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.error import URLError, HTTPError
from urllib.request import urlopen, Request

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

GREENHOUSE_API_URL = "https://boards-api.greenhouse.io/v1/boards/stokespacetechnologies/jobs"

DATA_DIR = Path(os.environ.get("STOKE_DATA_DIR", Path(__file__).resolve().parent / "data"))

SEEN_IDS_FILE     = DATA_DIR / "seen_job_ids.json"
LAST_RUN_IDS_FILE = DATA_DIR / "last_run_ids.json"   # {id: {title, url, location}} from previous run
MATCH_LOG_FILE    = DATA_DIR / "matched_jobs.log"
RUN_LOG_FILE      = DATA_DIR / "run_history.log"

# Optional webhook for notifications (Discord, Slack, ntfy, etc.)
# Set WEBHOOK_URL env var to enable. Discord webhooks are auto-detected and
# formatted as embeds; all others receive a generic JSON payload.
WEBHOOK_URL = os.environ.get("WEBHOOK_URL", "")

# Network settings
MAX_RETRIES            = 3
RETRY_DELAY_SECONDS    = 10
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
            if c["operator"] == "contains" and c["value"].lower() in field_val.lower():
                reasons.append(f'{c["field"]} contains "{c["value"]}" → "{field_val}"')
        return reasons

    def to_cache_dict(self) -> dict:
        return {"title": self.title, "url": self.url, "location": self.location}


# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------

def setup_logging() -> logging.Logger:
    logger = logging.getLogger("stoke_monitor")
    logger.setLevel(logging.DEBUG)

    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.INFO)
    ch.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s"))
    logger.addHandler(ch)

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
    tmp.replace(SEEN_IDS_FILE)


def load_last_run_ids() -> dict[str, dict]:
    """Load job cache from previous run. Returns {id: {title, url, location}}."""
    if LAST_RUN_IDS_FILE.exists():
        try:
            with open(LAST_RUN_IDS_FILE, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {}


def save_last_run_ids(jobs: list[Job]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = LAST_RUN_IDS_FILE.with_suffix(".tmp")
    cache = {job.id: job.to_cache_dict() for job in jobs}
    with open(tmp, "w") as f:
        json.dump(cache, f, indent=2)
    tmp.replace(LAST_RUN_IDS_FILE)


# ---------------------------------------------------------------------------
# HTTP helper with retries
# ---------------------------------------------------------------------------

def fetch_url(url: str, accept: str = "application/json") -> Optional[bytes]:
    """Fetch a URL with retries. Returns bytes or None on failure."""
    headers = {
        "User-Agent": "StokeJobMonitor/2.0 (personal job alert script)",
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
                return None  # not transient
        except (URLError, OSError, TimeoutError) as exc:
            log.warning("Network error on attempt %d/%d: %s", attempt, MAX_RETRIES, exc)

        if attempt < MAX_RETRIES:
            log.info("Retrying in %ds…", RETRY_DELAY_SECONDS)
            time.sleep(RETRY_DELAY_SECONDS)

    log.error("All %d attempts failed for %s", MAX_RETRIES, url)
    return None


# ---------------------------------------------------------------------------
# Greenhouse API
# ---------------------------------------------------------------------------

def fetch_jobs() -> list[Job]:
    """Fetch jobs from the Greenhouse boards API."""
    log.info("Querying Greenhouse API: %s", GREENHOUSE_API_URL)
    raw = fetch_url(GREENHOUSE_API_URL)
    if raw is None:
        log.error("Greenhouse API unavailable — no jobs retrieved this run")
        return []

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        log.error("Invalid JSON from API: %s", exc)
        return []

    jobs: list[Job] = []
    for item in (data.get("jobs") or []):
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
# Core logic
# ---------------------------------------------------------------------------

def process_jobs(
    jobs: list[Job],
    last_run_cache: dict[str, dict],
    dry_run: bool = False,
) -> tuple[list[Job], list[tuple[Job, list[str]]], list[tuple[str, dict]]]:
    """
    Compare fetched jobs against seen IDs and criteria.
    Returns (new_jobs, matched_with_reasons, removed_jobs).
    removed_jobs is a list of (id, cached_details) for jobs no longer on the board.
    """
    seen = load_seen_ids()
    now  = datetime.now(timezone.utc).isoformat()

    new_jobs: list[Job] = []
    matched:  list[tuple[Job, list[str]]] = []

    for job in jobs:
        if job.id in seen:
            continue
        new_jobs.append(job)
        seen[job.id] = now

        reasons = job.matches_criteria(CRITERIA)
        if reasons:
            matched.append((job, reasons))

    # Detect removed jobs (present last run, absent now)
    current_ids = {job.id for job in jobs}
    removed: list[tuple[str, dict]] = [
        (jid, details)
        for jid, details in last_run_cache.items()
        if jid not in current_ids
    ]

    if not dry_run:
        save_seen_ids(seen)
        save_last_run_ids(jobs)
    else:
        log.info("[dry-run] Skipping state file updates.")

    return new_jobs, matched, removed


# ---------------------------------------------------------------------------
# Notifications — log file + console
# ---------------------------------------------------------------------------

def notify(
    matched: list[tuple[Job, list[str]]],
    removed: list[tuple[str, dict]],
) -> None:
    """Print matches/removals to console and append to the match log file."""
    if not matched and not removed:
        log.info("No new matching jobs and no removals this run.")
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    lines: list[str] = []

    if matched:
        lines += [
            "",
            "=" * 72,
            f"  *** NEW MATCHING JOBS — {timestamp}",
            "=" * 72,
        ]
        for job, reasons in matched:
            lines += [
                "",
                f"  Title:      {job.title}",
                f"  ID:         {job.id}",
                f"  Location:   {job.location}",
                f"  Department: {job.department}",
                f"  URL:        {job.url}",
                f"  Matched:    {'; '.join(reasons)}",
                f"  Updated:    {job.updated_at}",
                "  " + "-" * 68,
            ]

    if removed:
        lines += [
            "",
            "=" * 72,
            f"  *** JOBS REMOVED FROM BOARD — {timestamp}",
            "=" * 72,
        ]
        for jid, details in removed:
            lines += [
                "",
                f"  Title:    {details.get('title', '(unknown)')}",
                f"  ID:       {jid}",
                f"  Location: {details.get('location', '')}",
                f"  URL:      {details.get('url', '')}",
                "  " + "-" * 68,
            ]

    output = "\n".join(lines)

    with open(MATCH_LOG_FILE, "a", encoding="utf-8") as f:
        f.write(output + "\n")

    print(output)


# ---------------------------------------------------------------------------
# Webhook notification
# ---------------------------------------------------------------------------

def notify_webhook(
    matched: list[tuple[Job, list[str]]],
    removed: list[tuple[str, dict]],
) -> None:
    """POST a notification to WEBHOOK_URL if configured."""
    if not WEBHOOK_URL or (not matched and not removed):
        return

    if "discord.com/api/webhooks" in WEBHOOK_URL:
        payload = _build_discord_payload(matched, removed)
    else:
        payload = _build_generic_payload(matched, removed)

    data = json.dumps(payload).encode("utf-8")
    req = Request(
        WEBHOOK_URL, data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=10) as resp:
            log.info("Webhook notification sent (HTTP %s)", resp.status)
    except Exception as exc:
        log.warning("Webhook notification failed: %s", exc)


def _build_discord_payload(matched, removed) -> dict:
    embeds = []
    for job, reasons in matched:
        embeds.append({
            "title": job.title,
            "url": job.url or None,
            "description": f"**{job.location or 'Location TBD'}**"
                           + (f" | {job.department}" if job.department else "")
                           + f"\n> {'; '.join(reasons)}",
            "color": 0xF05A28,  # Stoke orange
        })
    for jid, details in removed:
        embeds.append({
            "title": f"Removed: {details.get('title', jid)}",
            "description": f"This job was removed from the Stoke Space board.\n{details.get('url', '')}",
            "color": 0x6B7280,
        })
    return {"embeds": embeds[:10]}  # Discord max 10 embeds per request


def _build_generic_payload(matched, removed) -> dict:
    return {
        "matched_jobs": [
            {
                "title": j.title,
                "id": j.id,
                "location": j.location,
                "department": j.department,
                "url": j.url,
                "reasons": reasons,
            }
            for j, reasons in matched
        ],
        "removed_jobs": [
            {"id": jid, **details}
            for jid, details in removed
        ],
    }


# ---------------------------------------------------------------------------
# Run summary
# ---------------------------------------------------------------------------

def log_run_summary(
    total: int, new_count: int, match_count: int, removed_count: int, error: str = ""
) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    status = "ERROR" if error else "OK"
    entry = (
        f"{timestamp}  status={status}  total_jobs={total}  "
        f"new_jobs={new_count}  matches={match_count}  removed={removed_count}"
    )
    if error:
        entry += f"  error={error}"
    with open(RUN_LOG_FILE, "a", encoding="utf-8") as f:
        f.write(entry + "\n")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Stoke Space job board monitor",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--dry-run", action="store_true",
        help="Fetch and evaluate jobs without writing to any state files",
    )
    p.add_argument(
        "--reset", action="store_true",
        help="Delete seen-job state before running so all current jobs are treated as new",
    )
    return p.parse_args()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    args = parse_args()

    if args.reset:
        for f in (SEEN_IDS_FILE, LAST_RUN_IDS_FILE):
            if f.exists():
                f.unlink()
                log.info("Deleted %s (--reset)", f.name)

    log.info("=" * 50)
    log.info("Stoke Space Job Monitor — run started%s", " [DRY RUN]" if args.dry_run else "")
    log.info("=" * 50)

    try:
        last_run_cache = load_last_run_ids()
        jobs = fetch_jobs()
        new_jobs, matched, removed = process_jobs(jobs, last_run_cache, dry_run=args.dry_run)

        log.info(
            "Summary: %d total, %d new, %d matching criteria, %d removed",
            len(jobs), len(new_jobs), len(matched), len(removed),
        )

        if not args.dry_run:
            notify(matched, removed)
            notify_webhook(matched, removed)
            log_run_summary(len(jobs), len(new_jobs), len(matched), len(removed))
        else:
            # In dry-run, print what would be reported without writing logs
            if matched:
                log.info("[dry-run] Would alert on %d matching job(s):", len(matched))
                for job, reasons in matched:
                    log.info("  • %s (%s) — %s", job.title, job.location, "; ".join(reasons))
            if removed:
                log.info("[dry-run] Would report %d removed job(s):", len(removed))
                for jid, details in removed:
                    log.info("  • %s (id=%s)", details.get("title", "?"), jid)

    except Exception as exc:
        log.exception("Unexpected error during run")
        log_run_summary(0, 0, 0, 0, error=str(exc))
        sys.exit(1)

    log.info("Run complete.\n")


if __name__ == "__main__":
    main()
