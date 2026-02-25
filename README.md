# Precipitation Radial Card

A custom Home Assistant integration that displays a clock-style radial precipitation forecast using [PirateWeather](https://pirateweather.net/) data.

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)

The inner ring shows **minutely** precipitation intensity for the next 60 minutes. The outer ring shows **hourly** forecasts for the next 12 hours. The center displays current conditions, temperature, high/low, and wind speed.

## Features

- Clock-style radial visualization of precipitation forecasts
- Minutely precipitation ring (next 60 minutes)
- Hourly precipitation ring (next 12 hours)
- Current conditions with feels-like temperature, high/low, and wind speed
- Smart precipitation summaries ("Light Rain starting in 12 min, for 8 min")
- Auto-discovers entities — zero card configuration needed
- Configurable polling intervals (minutely and hourly, independently)
- Configurable location (latitude/longitude) — changeable anytime without reinstalling
- Responsive design using CSS container queries
- Color-coded intensity scale from green (light) to red (heavy)

## Installation

### HACS (Custom Repository)

1. Open HACS in Home Assistant
2. Click the three dots menu (top right) > **Custom repositories**
3. Add `https://github.com/philrenda/precipitation-radial-card` with category **Integration**
4. Click **Download**
5. Restart Home Assistant

### Manual

1. Copy the `custom_components/precipitation_radial` folder to your Home Assistant `config/custom_components/` directory
2. Restart Home Assistant

## Setup

1. Go to **Settings** > **Devices & Services** > **Add Integration**
2. Search for **Precipitation Radial Card**
3. Enter your PirateWeather API key and location
   - Get a free API key at [pirate-weather.apiable.io](https://pirate-weather.apiable.io/)
   - Latitude/longitude use decimal degrees (e.g. `40.712`, `-74.006`)
   - 3 decimal places is sufficient — PirateWeather resolves to a 13 km grid
4. The card and all 6 sensors are created automatically

### Adding the Card to a Dashboard

1. Edit your dashboard
2. **Add Card** > search for **Precipitation Radial Card**
3. The card auto-discovers its entities — no configuration needed

You can also manually specify entities in YAML if preferred:

```yaml
type: custom:precipitation-radial-card
entity_minutely: sensor.precipitation_radial_minutely_forecast
entity_hourly: sensor.precipitation_radial_hourly_forecast
entity_current_temperature: sensor.precipitation_radial_current_apparent_temperature
entity_high_temperature: sensor.precipitation_radial_today_high_temperature
entity_low_temperature: sensor.precipitation_radial_today_low_temperature
entity_wind_speed: sensor.precipitation_radial_current_wind_speed
```

## Configuration

All settings can be changed after installation — no need to remove and re-add the integration.

Go to **Settings** > **Devices & Services** > **Precipitation Radial Card** > **Configure** to change:

- **Latitude / Longitude** — change your forecast location
- **Minutely update interval** — how often to fetch minute-by-minute precipitation (default: 600 seconds)
- **Hourly update interval** — how often to fetch the hourly forecast (default: 1800 seconds)

Changes take effect immediately (the integration reloads automatically).

## API Usage & Recommended Intervals

The integration makes **2 API calls per update cycle** — one for minutely data, one for hourly data. Each Home Assistant restart also triggers a fetch for both.

[PirateWeather](https://pirate-weather.apiable.io/) tiers:
- **Free:** 10,000 calls/month
- **$2/mo donor:** 20,000 calls/month

| Minutely | Hourly | Calls/Month | Free (10k) | $2/mo (20k) |
|----------|--------|-------------|------------|--------------|
| 900s | 3600s | ~3,600 | Very safe | Very safe |
| **600s** | **1800s** | **~5,760** | **Comfortable (default)** | **Very safe** |
| 300s | 1200s | ~10,800 | Tight | Comfortable |
| 180s | 900s | ~17,280 | Exceeds | Comfortable |

**Formula:** `calls/month = ((86400 / minutely_seconds) + (86400 / hourly_seconds)) x 30`

## Sensors Created

The integration creates a **Precipitation Radial** device with 6 sensors:

| Sensor | Description | Unit |
|--------|-------------|------|
| Minutely Forecast | Minute-by-minute precipitation data (next 61 minutes) | — (data in attributes) |
| Hourly Forecast | Hourly forecast data (next 24 hours) | — (data in attributes) |
| Current Apparent Temperature | Feels-like temperature | °C (auto-converts to your HA unit system) |
| Today High Temperature | Today's high from hourly forecast | °C (auto-converts) |
| Today Low Temperature | Today's low from hourly forecast | °C (auto-converts) |
| Current Wind Speed | Current wind speed | m/s (auto-converts) |

## License

MIT
