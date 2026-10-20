"""Data update coordinators for PirateWeather API."""

import time
from datetime import timedelta

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import API_ENDPOINT, LOGGER
from .quota import record_response


class MinutelyCoordinator(DataUpdateCoordinator):
    """Coordinator for minutely precipitation data."""

    def __init__(
        self,
        hass: HomeAssistant,
        api_key: str,
        latitude: float,
        longitude: float,
        update_interval: int,
    ) -> None:
        super().__init__(
            hass,
            LOGGER,
            name="Precipitation Radial Minutely",
            update_interval=timedelta(seconds=update_interval),
        )
        self._api_key = api_key
        self._latitude = latitude
        self._longitude = longitude

    async def _async_update_data(self) -> dict:
        url = (
            f"{API_ENDPOINT}/{self._api_key}/{self._latitude},{self._longitude}"
            f"?exclude=hourly,daily,current,alerts,flags&units=us"
        )
        session = async_get_clientsession(self.hass)
        try:
            async with session.get(url, timeout=30) as resp:
                record_response(self.hass, self, resp)
                if resp.status != 200:
                    raise UpdateFailed(f"API returned {resp.status}")
                data = await resp.json(content_type=None)
        except UpdateFailed:
            raise
        except Exception as err:
            raise UpdateFailed(f"Error fetching minutely data: {err}") from err

        return {"minutely": data.get("minutely", {})}


class HourlyCoordinator(DataUpdateCoordinator):
    """Coordinator for hourly forecast and current conditions."""

    def __init__(
        self,
        hass: HomeAssistant,
        api_key: str,
        latitude: float,
        longitude: float,
        update_interval: int,
    ) -> None:
        super().__init__(
            hass,
            LOGGER,
            name="Precipitation Radial Hourly",
            update_interval=timedelta(seconds=update_interval),
        )
        self._api_key = api_key
        self._latitude = latitude
        self._longitude = longitude

    async def _async_update_data(self) -> dict:
        url = (
            f"{API_ENDPOINT}/{self._api_key}/{self._latitude},{self._longitude}"
            f"?exclude=minutely,alerts,flags&units=us"
        )
        session = async_get_clientsession(self.hass)
        try:
            async with session.get(url, timeout=30) as resp:
                record_response(self.hass, self, resp)
                if resp.status != 200:
                    raise UpdateFailed(f"API returned {resp.status}")
                data = await resp.json(content_type=None)
        except UpdateFailed:
            raise
        except Exception as err:
            raise UpdateFailed(f"Error fetching hourly data: {err}") from err

        return {
            "currently": data.get("currently", {}),
            "hourly": data.get("hourly", {}),
            "daily": data.get("daily", {}),
        }


class WeeklyCoordinator(DataUpdateCoordinator):
    """168-hour hourly forecast (extend=hourly), trimmed, for the per-day mini
    charts on the forecast drill-through page. Served to the page over the
    `precipitation_radial/week` websocket command."""

    def __init__(
        self,
        hass: HomeAssistant,
        api_key: str,
        latitude: float,
        longitude: float,
        update_interval: int,
    ) -> None:
        super().__init__(
            hass,
            LOGGER,
            name="Precipitation Radial Weekly",
            update_interval=timedelta(seconds=update_interval),
        )
        self._api_key = api_key
        self._latitude = latitude
        self._longitude = longitude

    async def _async_update_data(self) -> dict:
        url = (
            f"{API_ENDPOINT}/{self._api_key}/{self._latitude},{self._longitude}"
            f"?exclude=currently,minutely,daily,alerts,flags&extend=hourly&units=us"
        )
        session = async_get_clientsession(self.hass)
        try:
            async with session.get(url, timeout=30) as resp:
                record_response(self.hass, self, resp)
                if resp.status != 200:
                    raise UpdateFailed(f"API returned {resp.status}")
                data = await resp.json(content_type=None)
        except UpdateFailed:
            raise
        except Exception as err:
            raise UpdateFailed(f"Error fetching weekly data: {err}") from err

        hours = [
            {
                "t": h.get("time"),
                "T": round(float(h.get("temperature", 0)), 1),
                "p": round(float(h.get("precipProbability", 0)), 2),
                "i": round(float(h.get("precipIntensity", 0)), 3),
                "F": round(float(h.get("apparentTemperature", h.get("temperature", 0))), 1),
                "w": round(float(h.get("windSpeed", 0)), 1),
                "h": round(float(h.get("humidity", 0)), 2),
            }
            for h in data.get("hourly", {}).get("data", [])
        ]
        if len(hours) < 48:
            raise UpdateFailed(f"suspiciously few hours in weekly forecast ({len(hours)})")
        return {
            "updated": int(time.time()),
            "tz": data.get("timezone"),
            "lat": data.get("latitude", self._latitude),
            "lon": data.get("longitude", self._longitude),
            "hours": hours,
        }
