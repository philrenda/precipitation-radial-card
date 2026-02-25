"""Data update coordinators for PirateWeather API."""

from datetime import timedelta

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import API_ENDPOINT, LOGGER


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
            f"?exclude=hourly,daily,current,alerts,flags&units=si"
        )
        session = async_get_clientsession(self.hass)
        try:
            async with session.get(url, timeout=30) as resp:
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
            f"?exclude=minutely,daily,alerts,flags&units=si"
        )
        session = async_get_clientsession(self.hass)
        try:
            async with session.get(url, timeout=30) as resp:
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
        }
