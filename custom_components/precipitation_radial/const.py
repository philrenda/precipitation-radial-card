"""Constants for the Precipitation Radial Card integration."""

import logging

DOMAIN = "precipitation_radial"
LOGGER = logging.getLogger(__package__)

API_ENDPOINT = "https://api.pirateweather.net/forecast"

CONF_API_KEY = "api_key"
CONF_LATITUDE = "latitude"
CONF_LONGITUDE = "longitude"
CONF_MINUTELY_INTERVAL = "minutely_interval"
CONF_HOURLY_INTERVAL = "hourly_interval"
CONF_WEEKLY_INTERVAL = "weekly_interval"

DEFAULT_MINUTELY_INTERVAL = 600
DEFAULT_HOURLY_INTERVAL = 1800
DEFAULT_WEEKLY_INTERVAL = 3600

# Forecast drill-through page (served by the integration) + hidden panel
STATIC_URL_PATH = "/precipitation_radial/weather-overview.html"
PANEL_URL_PATH = "precipitation-forecast"
