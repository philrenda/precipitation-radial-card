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

DEFAULT_MINUTELY_INTERVAL = 300
DEFAULT_HOURLY_INTERVAL = 1200
