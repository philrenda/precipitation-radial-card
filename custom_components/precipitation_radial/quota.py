"""Pirate Weather API quota tracking and alerts.

Every API response carries Ratelimit-Limit / Ratelimit-Remaining /
Ratelimit-Reset headers. We record them, project the calls this integration
will make before the allowance resets, and warn the user (Repairs issue +
persistent notification) when the key is projected to run out or when the API
starts rejecting requests (HTTP 429). Both clear automatically on recovery.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from homeassistant.components import persistent_notification
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir

from .const import DOMAIN, LOGGER

DATA_KEY = f"{DOMAIN}_ratelimit"
ISSUE_EXCEEDED = "api_quota_exceeded"
ISSUE_PROJECTED = "api_quota_projected"
NOTIFY_ID = f"{DOMAIN}_api_quota"
LEARN_MORE_URL = "https://pirate-weather.apiable.io/"
OPTIONS_PATH = "Settings → Devices & services → Precipitation Radial Card → Configure"
CLEAR_RATIO = 0.9  # hysteresis: clear the projection warning below 90 % of remaining


def _state(hass: HomeAssistant) -> dict:
    return hass.data.setdefault(
        DATA_KEY,
        {
            "limit": None,
            "remaining": None,
            "reset_at": None,
            "updated": None,
            "calls_per_day": None,
            "projected_until_reset": None,
            "exceeded": False,
            "projected_flagged": False,
        },
    )


def _entry_intervals(hass: HomeAssistant) -> list[tuple[int, int, int]]:
    """(minutely, hourly, weekly) seconds for every entry that is loaded or loading.

    Derived from the config entries rather than from registered coordinator
    objects, so the number is right during an entry's first refresh too."""
    from homeassistant.config_entries import ConfigEntryState

    from .const import (
        CONF_HOURLY_INTERVAL,
        CONF_MINUTELY_INTERVAL,
        CONF_WEEKLY_INTERVAL,
        DEFAULT_HOURLY_INTERVAL,
        DEFAULT_MINUTELY_INTERVAL,
        DEFAULT_WEEKLY_INTERVAL,
    )

    out = []
    for entry in hass.config_entries.async_entries(DOMAIN):
        if entry.state not in (ConfigEntryState.LOADED, ConfigEntryState.SETUP_IN_PROGRESS):
            continue
        out.append(
            (
                int(entry.options.get(CONF_MINUTELY_INTERVAL, DEFAULT_MINUTELY_INTERVAL)),
                int(entry.options.get(CONF_HOURLY_INTERVAL, DEFAULT_HOURLY_INTERVAL)),
                int(entry.options.get(CONF_WEEKLY_INTERVAL, DEFAULT_WEEKLY_INTERVAL)),
            )
        )
    return out


def calls_per_day(hass: HomeAssistant, extra=None) -> float:
    """Calls/day at the configured intervals, summed over all entries."""
    return sum(
        86400 / m + 86400 / h + 86400 / w
        for m, h, w in _entry_intervals(hass)
        if m and h and w
    )


def _fmt_date(dt: datetime | None) -> str:
    return dt.astimezone().strftime("%b %d") if dt else "the next reset"


def _placeholders(hass: HomeAssistant, extra) -> dict[str, str]:
    st = _state(hass)
    cpd = st["calls_per_day"] or calls_per_day(hass, extra)
    remaining = st["remaining"] or 0
    projected = st["projected_until_reset"] or 0
    ratio = (projected / remaining) if remaining else 2.0
    # Suggested intervals: scale the current ones by the overshoot (+10 %), rounded up to a minute
    intervals = _entry_intervals(hass) or [(600, 1800, 3600)]
    cur_min = max(m for m, _, _ in intervals)
    cur_hr = max(h for _, h, _ in intervals)
    cur_wk = max(w for _, _, w in intervals)

    def suggest(cur: int) -> str:
        return str(int(math.ceil(cur * max(ratio, 1.0) * 1.1 / 60) * 60))

    return {
        "limit": str(st["limit"] or "?"),
        "remaining": str(remaining),
        "reset_date": _fmt_date(st["reset_at"]),
        "calls_per_day": str(int(round(cpd))),
        "projected": str(int(round(projected))),
        "suggest_minutely": suggest(cur_min),
        "suggest_hourly": suggest(cur_hr),
        "suggest_weekly": suggest(cur_wk),
        "options_path": OPTIONS_PATH,
    }


def _notify(hass: HomeAssistant, title: str, message: str) -> None:
    persistent_notification.async_create(hass, message, title=title, notification_id=NOTIFY_ID)


def _clear_notify(hass: HomeAssistant) -> None:
    persistent_notification.async_dismiss(hass, NOTIFY_ID)


def _raise_exceeded(hass: HomeAssistant, extra) -> None:
    st = _state(hass)
    if st["exceeded"]:
        return
    st["exceeded"] = True
    ph = _placeholders(hass, extra)
    ir.async_create_issue(
        hass, DOMAIN, ISSUE_EXCEEDED,
        is_fixable=False, severity=ir.IssueSeverity.ERROR,
        translation_key=ISSUE_EXCEEDED, translation_placeholders=ph,
        learn_more_url=LEARN_MORE_URL,
    )
    _notify(
        hass,
        "Pirate Weather API limit reached",
        f"Pirate Weather is rejecting requests (HTTP 429): the {ph['limit']} calls/month "
        f"allowance of your API key is used up until {ph['reset_date']}. The card and "
        f"forecast page will show stale data until then.\n\n"
        f"Raise the update intervals under {OPTIONS_PATH} "
        f"(currently about {ph['calls_per_day']} calls/day), or upgrade your Pirate Weather "
        f"subscription at {LEARN_MORE_URL}",
    )
    LOGGER.warning("Pirate Weather API quota exceeded (HTTP 429); user notified")


def _raise_projected(hass: HomeAssistant, extra) -> None:
    st = _state(hass)
    if st["projected_flagged"] or st["exceeded"]:
        return
    st["projected_flagged"] = True
    ph = _placeholders(hass, extra)
    ir.async_create_issue(
        hass, DOMAIN, ISSUE_PROJECTED,
        is_fixable=False, severity=ir.IssueSeverity.WARNING,
        translation_key=ISSUE_PROJECTED, translation_placeholders=ph,
        learn_more_url=LEARN_MORE_URL,
    )
    _notify(
        hass,
        "Pirate Weather API limit will be reached",
        f"At the current update intervals (about {ph['calls_per_day']} calls/day) this "
        f"integration will make about {ph['projected']} more calls before your allowance "
        f"resets on {ph['reset_date']}, but only {ph['remaining']} of {ph['limit']} remain.\n\n"
        f"Raise the intervals under {OPTIONS_PATH} (e.g. minutely ≥ {ph['suggest_minutely']}s, "
        f"hourly ≥ {ph['suggest_hourly']}s, weekly ≥ {ph['suggest_weekly']}s), or upgrade your Pirate Weather subscription at "
        f"{LEARN_MORE_URL}",
    )
    LOGGER.warning(
        "Pirate Weather API quota projected to run out before reset "
        "(%s calls/day, %s projected, %s remaining); user notified",
        ph["calls_per_day"], ph["projected"], ph["remaining"],
    )


def _clear(hass: HomeAssistant, which: str) -> None:
    st = _state(hass)
    if which == "exceeded" and st["exceeded"]:
        st["exceeded"] = False
        ir.async_delete_issue(hass, DOMAIN, ISSUE_EXCEEDED)
        _clear_notify(hass)
        LOGGER.info("Pirate Weather API quota: requests succeeding again")
    if which == "projected" and st["projected_flagged"]:
        st["projected_flagged"] = False
        ir.async_delete_issue(hass, DOMAIN, ISSUE_PROJECTED)
        _clear_notify(hass)
        LOGGER.info("Pirate Weather API quota projection back within the allowance")


def _evaluate(hass: HomeAssistant, extra) -> None:
    st = _state(hass)
    if st["remaining"] is None or st["reset_at"] is None:
        return
    cpd = calls_per_day(hass, extra)
    days_left = max((st["reset_at"] - datetime.now(timezone.utc)).total_seconds(), 0) / 86400
    projected = cpd * days_left
    st["calls_per_day"] = cpd
    st["projected_until_reset"] = projected
    if projected > st["remaining"]:
        _raise_projected(hass, extra)
    elif projected < st["remaining"] * CLEAR_RATIO:
        _clear(hass, "projected")


def refresh_projection(hass: HomeAssistant) -> None:
    """Re-run the projection with every registered coordinator (call after setup)."""
    _evaluate(hass, None)


def record_response(hass: HomeAssistant, coordinator, resp) -> None:
    """Call for every API response (any status) inside the event loop."""
    st = _state(hass)
    h = resp.headers
    try:
        if h.get("Ratelimit-Limit") is not None:
            st["limit"] = int(h["Ratelimit-Limit"])
        if h.get("Ratelimit-Remaining") is not None:
            st["remaining"] = int(h["Ratelimit-Remaining"])
        if h.get("Ratelimit-Reset") is not None:
            st["reset_at"] = datetime.now(timezone.utc) + timedelta(seconds=int(h["Ratelimit-Reset"]))
        st["updated"] = datetime.now(timezone.utc)
    except (TypeError, ValueError) as err:  # header format changed — never break fetching
        LOGGER.debug("Could not parse Pirate Weather rate-limit headers: %s", err)

    if resp.status == 429:
        if st["remaining"] is None:
            st["remaining"] = 0
        _raise_exceeded(hass, coordinator)
        return
    if resp.status == 200:
        _clear(hass, "exceeded")
        _evaluate(hass, coordinator)
