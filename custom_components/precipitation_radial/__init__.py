"""The Precipitation Radial Card integration."""

from __future__ import annotations

import glob
import hashlib
import os

import voluptuous as vol

import homeassistant.helpers.aiohttp_client
import homeassistant.helpers.config_validation as cv
from homeassistant.components import websocket_api
from homeassistant.components.frontend import (
    async_register_built_in_panel,
    async_remove_panel,
)
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant, ServiceCall, callback

from .const import (
    CONF_API_KEY,
    CONF_HOURLY_INTERVAL,
    CONF_LATITUDE,
    CONF_LONGITUDE,
    CONF_MINUTELY_INTERVAL,
    CONF_WEEKLY_INTERVAL,
    DEFAULT_HOURLY_INTERVAL,
    DEFAULT_MINUTELY_INTERVAL,
    DEFAULT_WEEKLY_INTERVAL,
    DOMAIN,
    LOGGER,
    PANEL_URL_PATH,
    STATIC_URL_PATH,
)
from .coordinator import HourlyCoordinator, MinutelyCoordinator, WeeklyCoordinator
from .quota import refresh_projection

PLATFORMS = ["sensor"]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

SERVICE_UPDATE_LOCATION = "update_location"
SERVICE_UPDATE_LOCATION_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_LATITUDE): vol.Coerce(float),
        vol.Required(CONF_LONGITUDE): vol.Coerce(float),
    }
)


async def _register_card(hass: HomeAssistant) -> None:
    """Copy card JS to www/ and register as a lovelace resource."""
    import shutil

    src = os.path.join(os.path.dirname(__file__), "www", "precipitation-radial-card.js")
    dst_dir = os.path.join(hass.config.config_dir, "www", "community", "precipitation-radial-card")

    def _copy_card() -> str:
        """Synchronous file operations for executor."""
        os.makedirs(dst_dir, exist_ok=True)

        with open(src, "rb") as f:
            ver = hashlib.md5(f.read()).hexdigest()[:8]

        dst_filename = f"precipitation-radial-card-{ver}.js"
        dst = os.path.join(dst_dir, dst_filename)

        for old in glob.glob(os.path.join(dst_dir, "precipitation-radial-card*.js")):
            if old != dst:
                os.remove(old)

        shutil.copy2(src, dst)
        return dst_filename

    dst_filename = await hass.async_add_executor_job(_copy_card)

    url_with_ver = f"/local/community/precipitation-radial-card/{dst_filename}"

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


async def _reverse_geocode(hass: HomeAssistant, latitude: float, longitude: float) -> str:
    """Reverse geocode lat/lon to a 'City, State/Region' string via Nominatim."""
    session = homeassistant.helpers.aiohttp_client.async_get_clientsession(hass)
    url = (
        f"https://nominatim.openstreetmap.org/reverse"
        f"?lat={latitude}&lon={longitude}&format=json&zoom=10"
    )
    headers = {"User-Agent": "HomeAssistant-PrecipitationRadialCard/1.0"}
    try:
        async with session.get(url, headers=headers, timeout=10) as resp:
            if resp.status != 200:
                return ""
            data = await resp.json(content_type=None)
            addr = data.get("address", {})
            city = (
                addr.get("city")
                or addr.get("town")
                or addr.get("village")
                or addr.get("municipality")
                or addr.get("hamlet")
                or ""
            )
            region = (
                addr.get("state")
                or addr.get("province")
                or addr.get("region")
                or addr.get("county")
                or ""
            )
            parts = [p for p in (city, region) if p]
            return ", ".join(parts)
    except Exception:
        LOGGER.debug("Reverse geocode failed for %s,%s", latitude, longitude)
        return ""


async def _register_forecast_page(hass: HomeAssistant) -> None:
    """Serve the forecast drill-through page and expose it as a hidden panel.

    The panel has no sidebar entry, so it is reachable by URL from any
    dashboard (the card's default tap navigates there) without the user
    adding anything to their dashboards."""
    if f"{DOMAIN}_static_registered" not in hass.data:
        page = os.path.join(os.path.dirname(__file__), "www", "weather-overview.html")
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL_PATH, page, False)]
        )
        hass.data[f"{DOMAIN}_static_registered"] = True
    if f"{DOMAIN}_panel_registered" not in hass.data:
        async_register_built_in_panel(
            hass,
            "iframe",
            frontend_url_path=PANEL_URL_PATH,
            config={"url": STATIC_URL_PATH},
            require_admin=False,
        )
        hass.data[f"{DOMAIN}_panel_registered"] = True


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/week"})
@callback
def _ws_week(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Return the trimmed 168 h hourly forecast for the drill-through page."""
    for entry_data in hass.data.get(DOMAIN, {}).values():
        coord = entry_data.get("weekly") if isinstance(entry_data, dict) else None
        if coord is not None and coord.data:
            connection.send_result(msg["id"], coord.data)
            return
    connection.send_error(msg["id"], "not_ready", "Weekly forecast not loaded yet")


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Precipitation Radial Card from a config entry."""
    if f"{DOMAIN}_card_registered" not in hass.data:
        await _register_card(hass)
        hass.data[f"{DOMAIN}_card_registered"] = True
    await _register_forecast_page(hass)
    if f"{DOMAIN}_ws_registered" not in hass.data:
        websocket_api.async_register_command(hass, _ws_week)
        hass.data[f"{DOMAIN}_ws_registered"] = True

    api_key = entry.data[CONF_API_KEY]
    latitude = entry.options.get(CONF_LATITUDE, entry.data[CONF_LATITUDE])
    longitude = entry.options.get(CONF_LONGITUDE, entry.data[CONF_LONGITUDE])

    minutely_interval = entry.options.get(
        CONF_MINUTELY_INTERVAL, DEFAULT_MINUTELY_INTERVAL
    )
    hourly_interval = entry.options.get(
        CONF_HOURLY_INTERVAL, DEFAULT_HOURLY_INTERVAL
    )
    weekly_interval = entry.options.get(
        CONF_WEEKLY_INTERVAL, DEFAULT_WEEKLY_INTERVAL
    )

    minutely_coord = MinutelyCoordinator(
        hass, api_key, latitude, longitude, minutely_interval
    )
    hourly_coord = HourlyCoordinator(
        hass, api_key, latitude, longitude, hourly_interval
    )

    weekly_coord = WeeklyCoordinator(
        hass, api_key, latitude, longitude, weekly_interval
    )

    await minutely_coord.async_config_entry_first_refresh()
    await hourly_coord.async_config_entry_first_refresh()
    # The weekly fetch only feeds the drill-through page: a failure must not
    # block the card's sensors, so it is not a first-refresh gate.
    await weekly_coord.async_refresh()

    location_name = await _reverse_geocode(hass, latitude, longitude)

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {
        "minutely": minutely_coord,
        "hourly": hourly_coord,
        "weekly": weekly_coord,
        "location_name": location_name,
    }
    # first refreshes ran before this entry's coordinators were registered, so
    # the quota projection only saw one of them — recompute with all of them
    refresh_projection(hass)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    entry.async_on_unload(entry.add_update_listener(_async_options_updated))

    # Register update_location service (only once across all entries)
    if not hass.services.has_service(DOMAIN, SERVICE_UPDATE_LOCATION):

        async def handle_update_location(call: ServiceCall) -> None:
            """Update lat/lon in the first config entry's options and reload."""
            new_lat = call.data[CONF_LATITUDE]
            new_lon = call.data[CONF_LONGITUDE]
            entries = hass.config_entries.async_entries(DOMAIN)
            if not entries:
                LOGGER.warning("No config entries found for %s", DOMAIN)
                return
            target_entry = entries[0]
            new_options = dict(target_entry.options)
            new_options[CONF_LATITUDE] = new_lat
            new_options[CONF_LONGITUDE] = new_lon
            hass.config_entries.async_update_entry(
                target_entry, options=new_options
            )

        hass.services.async_register(
            DOMAIN,
            SERVICE_UPDATE_LOCATION,
            handle_update_location,
            schema=SERVICE_UPDATE_LOCATION_SCHEMA,
        )

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
        others = [
            e for e in hass.config_entries.async_entries(DOMAIN)
            if e.entry_id != entry.entry_id and e.state is ConfigEntryState.LOADED
        ]
        if not others and hass.data.pop(f"{DOMAIN}_panel_registered", None):
            async_remove_panel(hass, PANEL_URL_PATH)
    return unload_ok
