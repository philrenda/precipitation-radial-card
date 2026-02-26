"""Sensor platform for Precipitation Radial Card."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfSpeed, UnitOfTemperature
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceEntryType
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import HourlyCoordinator, MinutelyCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Precipitation Radial sensors from a config entry."""
    coordinators = hass.data[DOMAIN][entry.entry_id]
    minutely_coord: MinutelyCoordinator = coordinators["minutely"]
    hourly_coord: HourlyCoordinator = coordinators["hourly"]

    device_info = DeviceInfo(
        identifiers={(DOMAIN, entry.entry_id)},
        name="Precipitation Radial",
        manufacturer="PirateWeather",
        entry_type=DeviceEntryType.SERVICE,
    )

    location_name = coordinators.get("location_name", "")

    async_add_entities(
        [
            MinutelyForecastSensor(minutely_coord, entry, device_info, location_name),
            HourlyForecastSensor(hourly_coord, entry, device_info),
            CurrentApparentTemperatureSensor(hourly_coord, entry, device_info),
            TodayHighTemperatureSensor(hourly_coord, entry, device_info),
            TodayLowTemperatureSensor(hourly_coord, entry, device_info),
            CurrentWindSpeedSensor(hourly_coord, entry, device_info),
        ]
    )


class PrecipitationRadialSensor(CoordinatorEntity, SensorEntity):
    """Base class for Precipitation Radial sensors."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator,
        entry: ConfigEntry,
        device_info: DeviceInfo,
        key: str,
    ) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_device_info = device_info


class MinutelyForecastSensor(PrecipitationRadialSensor):
    """Minutely precipitation forecast data."""

    def __init__(self, coordinator, entry, device_info, location_name: str = "") -> None:
        super().__init__(coordinator, entry, device_info, "minutely_forecast")
        self._attr_name = "Minutely Forecast"
        self._attr_icon = "mdi:weather-rainy"
        self._location_name = location_name

    @property
    def native_value(self) -> str | None:
        if self.coordinator.data:
            return datetime.now(timezone.utc).isoformat()
        return None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        if not self.coordinator.data:
            return {"data": [], "location_name": self._location_name}
        minutely = self.coordinator.data.get("minutely", {})
        raw = minutely.get("data", [])
        return {
            "location_name": self._location_name,
            "data": [
                {
                    "time": item.get("time"),
                    "precipIntensity": round(float(item.get("precipIntensity", 0)), 4),
                    "precipProbability": round(float(item.get("precipProbability", 0)), 4),
                    "precipIntensityError": round(float(item.get("precipIntensityError", 0)), 4),
                    "precipType": item.get("precipType", "none"),
                }
                for item in raw
            ],
        }


class HourlyForecastSensor(PrecipitationRadialSensor):
    """Hourly precipitation forecast data."""

    def __init__(self, coordinator, entry, device_info) -> None:
        super().__init__(coordinator, entry, device_info, "hourly_forecast")
        self._attr_name = "Hourly Forecast"
        self._attr_icon = "mdi:weather-partly-cloudy"

    @property
    def native_value(self) -> str | None:
        if self.coordinator.data:
            return datetime.now(timezone.utc).isoformat()
        return None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        if not self.coordinator.data:
            return {"data": []}
        hourly = self.coordinator.data.get("hourly", {})
        data = hourly.get("data", [])[:24]
        return {
            "data": [
                {
                    "time": item.get("time"),
                    "icon": item.get("icon", ""),
                    "summary": item.get("summary", ""),
                    "temperature": round(float(item.get("temperature", 0))),
                    "precipIntensity": round(float(item.get("precipIntensity", 0)), 4),
                    "precipProbability": round(float(item.get("precipProbability", 0)), 4),
                }
                for item in data
            ]
        }


class CurrentApparentTemperatureSensor(PrecipitationRadialSensor):
    """Current actual temperature."""

    _attr_device_class = SensorDeviceClass.TEMPERATURE
    _attr_native_unit_of_measurement = UnitOfTemperature.FAHRENHEIT
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 1

    def __init__(self, coordinator, entry, device_info) -> None:
        super().__init__(
            coordinator, entry, device_info, "current_apparent_temperature"
        )
        self._attr_name = "Current Temperature"

    @property
    def native_value(self) -> float | None:
        if not self.coordinator.data:
            return None
        currently = self.coordinator.data.get("currently", {})
        val = currently.get("temperature")
        return round(float(val), 1) if val is not None else None


class TodayHighTemperatureSensor(PrecipitationRadialSensor):
    """Today's high temperature derived from hourly forecast."""

    _attr_device_class = SensorDeviceClass.TEMPERATURE
    _attr_native_unit_of_measurement = UnitOfTemperature.FAHRENHEIT
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 0

    def __init__(self, coordinator, entry, device_info) -> None:
        super().__init__(
            coordinator, entry, device_info, "today_high_temperature"
        )
        self._attr_name = "Today High Temperature"

    @property
    def native_value(self) -> float | None:
        if not self.coordinator.data:
            return None
        hourly = self.coordinator.data.get("hourly", {})
        data = hourly.get("data", [])
        if not data:
            return None

        now = datetime.now(timezone.utc)
        midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
        midnight_ts = midnight.timestamp()
        end_of_day_ts = midnight_ts + 86400

        temps = [
            float(item["temperature"])
            for item in data
            if "time" in item
            and "temperature" in item
            and midnight_ts <= item["time"] < end_of_day_ts
        ]
        return round(max(temps)) if temps else None


class TodayLowTemperatureSensor(PrecipitationRadialSensor):
    """Today's low temperature derived from hourly forecast."""

    _attr_device_class = SensorDeviceClass.TEMPERATURE
    _attr_native_unit_of_measurement = UnitOfTemperature.FAHRENHEIT
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 0

    def __init__(self, coordinator, entry, device_info) -> None:
        super().__init__(
            coordinator, entry, device_info, "today_low_temperature"
        )
        self._attr_name = "Today Low Temperature"

    @property
    def native_value(self) -> float | None:
        if not self.coordinator.data:
            return None
        hourly = self.coordinator.data.get("hourly", {})
        data = hourly.get("data", [])
        if not data:
            return None

        now = datetime.now(timezone.utc)
        midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
        midnight_ts = midnight.timestamp()
        end_of_day_ts = midnight_ts + 86400

        temps = [
            float(item["temperature"])
            for item in data
            if "time" in item
            and "temperature" in item
            and midnight_ts <= item["time"] < end_of_day_ts
        ]
        return round(min(temps)) if temps else None


class CurrentWindSpeedSensor(PrecipitationRadialSensor):
    """Current wind speed."""

    _attr_device_class = SensorDeviceClass.WIND_SPEED
    _attr_native_unit_of_measurement = UnitOfSpeed.MILES_PER_HOUR
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 0

    def __init__(self, coordinator, entry, device_info) -> None:
        super().__init__(
            coordinator, entry, device_info, "current_wind_speed"
        )
        self._attr_name = "Current Wind Speed"

    @property
    def native_value(self) -> float | None:
        if not self.coordinator.data:
            return None
        currently = self.coordinator.data.get("currently", {})
        val = currently.get("windSpeed")
        return round(float(val)) if val is not None else None
