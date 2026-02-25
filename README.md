# Precipitation Radial Card

A Home Assistant custom integration that provides a clock-style radial precipitation forecast card powered by [PirateWeather](https://pirateweather.net/).

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)

## Features

- **Radial minute-by-minute precipitation display** — 60-minute forecast shown as a color-coded ring
- **12-hour hourly forecast** — precipitation dots positioned on a clock face
- **Current conditions** — apparent temperature, daily high/low, wind speed
- **Smart weather summary** — auto-detects precipitation type, start/end times, and intensity
- **Zero-config card** — auto-discovers entities, no YAML card configuration needed
- **Config flow setup** — add via UI with API key validation
- **Configurable polling intervals** — minutely (default 5 min) and hourly (default 20 min)

## Installation

### HACS (Custom Repository)

1. Open HACS in Home Assistant
2. Click the three dots menu (top right) > **Custom repositories**
3. Add `https://github.com/prenda/precipitation-radial-card` with category **Integration**
4. Click **Install**
5. Restart Home Assistant

### Manual

1. Copy the `custom_components/precipitation_radial` directory to your Home Assistant `config/custom_components/` directory
2. Restart Home Assistant

## Setup

1. Go to **Settings > Devices & Services > Add Integration**
2. Search for **Precipitation Radial Card**
3. Enter your [PirateWeather API key](https://pirate-weather.apiable.io/) and location coordinates
4. The integration creates 6 sensors and auto-registers the card JS

## Card Usage

Add the card to any dashboard — it auto-discovers its entities:

```yaml
type: custom:precipitation-radial-card
```

Or specify entities explicitly:

```yaml
type: custom:precipitation-radial-card
entity_minutely: sensor.precipitation_radial_minutely_forecast
entity_hourly: sensor.precipitation_radial_hourly_forecast
entity_current_temperature: sensor.precipitation_radial_current_apparent_temperature
entity_high_temperature: sensor.precipitation_radial_today_high_temperature
entity_low_temperature: sensor.precipitation_radial_today_low_temperature
entity_wind_speed: sensor.precipitation_radial_current_wind_speed
```

## Sensors Created

| Sensor | Description |
|---|---|
| Minutely Forecast | 61-point minutely precipitation data (attributes) |
| Hourly Forecast | 24-hour forecast with icons, temps, precipitation (attributes) |
| Current Apparent Temperature | Feels-like temperature |
| Today High Temperature | Derived from hourly forecast |
| Today Low Temperature | Derived from hourly forecast |
| Current Wind Speed | Current wind speed |

All temperature sensors store values in Celsius and auto-convert to your HA unit system.

## Options

After setup, configure polling intervals via the integration options:

- **Minutely interval**: 60-3600 seconds (default: 300)
- **Hourly interval**: 300-7200 seconds (default: 1200)

With defaults, the integration uses ~360 API calls/day (PirateWeather free tier allows 2000/day).

## License

MIT
