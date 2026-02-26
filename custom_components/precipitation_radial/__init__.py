"""The Precipitation Radial Card integration."""

from __future__ import annotations

import hashlib
import os

import homeassistant.helpers.config_validation as cv
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import (
    CONF_API_KEY,
    CONF_HOURLY_INTERVAL,
    CONF_LATITUDE,
    CONF_LONGITUDE,
    CONF_MINUTELY_INTERVAL,
    DEFAULT_HOURLY_INTERVAL,
    DEFAULT_MINUTELY_INTERVAL,
    DOMAIN,
    LOGGER,
)
from .coordinator import HourlyCoordinator, MinutelyCoordinator

PLATFORMS = ["sensor"]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def _register_card(hass: HomeAssistant) -> None:
    """Copy card JS to www/ and register as a lovelace resource."""
    import shutil

    src = os.path.join(os.path.dirname(__file__), "www", "precipitation-radial-card.js")
    dst_dir = os.path.join(hass.config.config_dir, "www", "community", "precipitation-radial-card")
    dst = os.path.join(dst_dir, "precipitation-radial-card.js")

    # Copy card JS to www/ so it's served via /local/
    os.makedirs(dst_dir, exist_ok=True)
    shutil.copy2(src, dst)

    url_path = "/local/community/precipitation-radial-card/precipitation-radial-card.js"

    # Generate version hash from file contents for cache busting
    with open(src, "rb") as f:
        ver = hashlib.md5(f.read()).hexdigest()[:8]

    # Register lovelace resource
    from homeassistant.components.lovelace.resources import ResourceStorageCollection

    lovelace = hass.data.get("lovelace")
    if lovelace is not None:
        resources: ResourceStorageCollection = (
            lovelace.resources
            if hasattr(lovelace, "resources")
            else lovelace["resources"]
        )
        await resources.async_get_info()

        url_with_ver = f"{url_path}?v={ver}"

        # Check if resource already registered
        found = False
        for item in resources.async_items():
            if "precipitation-radial-card" in item.get("url", ""):
                found = True
                if item["url"] != url_with_ver:
                    if isinstance(resources, ResourceStorageCollection):
                        await resources.async_update_item(
                            item["id"],
                            {"res_type": "module", "url": url_with_ver},
                        )
                    else:
                        item["url"] = url_with_ver
                break

        if not found:
            if isinstance(resources, ResourceStorageCollection):
                await resources.async_create_item(
                    {"res_type": "module", "url": url_with_ver}
                )
            else:
                from homeassistant.components.frontend import add_extra_js_url

                add_extra_js_url(hass, url_with_ver)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Precipitation Radial Card from a config entry."""
    if f"{DOMAIN}_card_registered" not in hass.data:
        await _register_card(hass)
        hass.data[f"{DOMAIN}_card_registered"] = True

    api_key = entry.data[CONF_API_KEY]
    latitude = entry.options.get(CONF_LATITUDE, entry.data[CONF_LATITUDE])
    longitude = entry.options.get(CONF_LONGITUDE, entry.data[CONF_LONGITUDE])

    minutely_interval = entry.options.get(
        CONF_MINUTELY_INTERVAL, DEFAULT_MINUTELY_INTERVAL
    )
    hourly_interval = entry.options.get(
        CONF_HOURLY_INTERVAL, DEFAULT_HOURLY_INTERVAL
    )

    minutely_coord = MinutelyCoordinator(
        hass, api_key, latitude, longitude, minutely_interval
    )
    hourly_coord = HourlyCoordinator(
        hass, api_key, latitude, longitude, hourly_interval
    )

    await minutely_coord.async_config_entry_first_refresh()
    await hourly_coord.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {
        "minutely": minutely_coord,
        "hourly": hourly_coord,
    }

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    entry.async_on_unload(entry.add_update_listener(_async_options_updated))

    return True


async def _async_options_updated(
    hass: HomeAssistant, entry: ConfigEntry
) -> None:
    """Handle options update — reload the entry to apply new intervals."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)
    return unload_ok
