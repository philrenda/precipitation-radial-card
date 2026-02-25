"""Config flow for Precipitation Radial Card."""

from __future__ import annotations

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, OptionsFlow
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    API_ENDPOINT,
    CONF_API_KEY,
    CONF_HOURLY_INTERVAL,
    CONF_LATITUDE,
    CONF_LONGITUDE,
    CONF_MINUTELY_INTERVAL,
    DEFAULT_HOURLY_INTERVAL,
    DEFAULT_MINUTELY_INTERVAL,
    DOMAIN,
)


class PrecipitationRadialConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Precipitation Radial Card."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict | None = None
    ) -> FlowResult:
        errors = {}

        if user_input is not None:
            api_key = user_input[CONF_API_KEY]
            latitude = user_input[CONF_LATITUDE]
            longitude = user_input[CONF_LONGITUDE]

            # Set unique ID to prevent duplicate entries for same location
            await self.async_set_unique_id(
                f"precipitation_radial_{latitude}_{longitude}"
            )
            self._abort_if_unique_id_configured()

            # Validate the API key with a lightweight test call
            session = async_get_clientsession(self.hass)
            try:
                url = (
                    f"{API_ENDPOINT}/{api_key}/{latitude},{longitude}"
                    f"?exclude=minutely,hourly,daily,alerts,flags&units=si"
                )
                async with session.get(url, timeout=15) as resp:
                    if resp.status == 403:
                        errors["base"] = "invalid_api_key"
                    elif resp.status != 200:
                        errors["base"] = "cannot_connect"
            except Exception:
                errors["base"] = "cannot_connect"

            if not errors:
                return self.async_create_entry(
                    title=f"Precipitation Radial ({latitude}, {longitude})",
                    data=user_input,
                )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_API_KEY): str,
                    vol.Required(
                        CONF_LATITUDE,
                        default=self.hass.config.latitude,
                    ): vol.Coerce(float),
                    vol.Required(
                        CONF_LONGITUDE,
                        default=self.hass.config.longitude,
                    ): vol.Coerce(float),
                }
            ),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return PrecipitationRadialOptionsFlow(config_entry)


class PrecipitationRadialOptionsFlow(OptionsFlow):
    """Handle options flow for Precipitation Radial Card."""

    def __init__(self, config_entry: ConfigEntry) -> None:
        self._config_entry = config_entry

    async def async_step_init(
        self, user_input: dict | None = None
    ) -> FlowResult:
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_MINUTELY_INTERVAL,
                        default=self._config_entry.options.get(
                            CONF_MINUTELY_INTERVAL, DEFAULT_MINUTELY_INTERVAL
                        ),
                    ): vol.All(vol.Coerce(int), vol.Range(min=60, max=3600)),
                    vol.Required(
                        CONF_HOURLY_INTERVAL,
                        default=self._config_entry.options.get(
                            CONF_HOURLY_INTERVAL, DEFAULT_HOURLY_INTERVAL
                        ),
                    ): vol.All(vol.Coerce(int), vol.Range(min=300, max=7200)),
                }
            ),
        )
