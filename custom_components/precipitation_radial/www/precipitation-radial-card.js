class PrecipitationRadialCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._resolved = false;
    this._lastStateSnapshot = null;
    this._iconMap = {
      'clear-day': 'mdi:weather-sunny',
      'clear-night': 'mdi:weather-night',
      'rain': 'mdi:weather-rainy',
      'snow': 'mdi:weather-snowy',
      'sleet': 'mdi:weather-snowy-rainy',
      'wind': 'mdi:weather-windy',
      'fog': 'mdi:weather-fog',
      'cloudy': 'mdi:weather-cloudy',
      'partly-cloudy-day': 'mdi:weather-partly-cloudy',
      'partly-cloudy-night': 'mdi:weather-night-partly-cloudy',
      'hail': 'mdi:weather-hail',
      'thunderstorm': 'mdi:weather-lightning',
      'sunny': 'mdi:weather-sunny',
      'mostly_sunny': 'mdi:weather-sunny',
      'partly_sunny': 'mdi:weather-partly-cloudy',
      'mostly_cloudy': 'mdi:weather-cloudy',
      'chance_of_rain': 'mdi:weather-rainy',
      'showers': 'mdi:weather-showers',
    };
  }

  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    this._config = config;
    this._resolved = false;
    // If all 6 entities are explicitly provided, mark as resolved immediately
    if (
      config.entity_minutely &&
      config.entity_hourly &&
      config.entity_current_temperature &&
      config.entity_high_temperature &&
      config.entity_low_temperature &&
      config.entity_wind_speed
    ) {
      this._resolved = true;
    }
    if (this._hass) this._updateCard(this._hass);
  }

  set hass(hass) {
    this._hass = hass;
    // Auto-discover entities if not explicitly configured
    if (!this._resolved) {
      this._autoDiscover(hass);
    }
    if (this._hasRelevantStateChanged(hass)) {
      this._updateCard(hass);
    }
  }

  _hasRelevantStateChanged(hass) {
    if (!this._resolved) return true;

    const config = this._config;
    const entityKeys = [
      config.entity_minutely,
      config.entity_hourly,
      config.entity_current_temperature,
      config.entity_high_temperature,
      config.entity_low_temperature,
      config.entity_wind_speed,
    ];

    const snapshot = entityKeys.map(eid => {
      const s = eid ? hass.states[eid] : undefined;
      if (!s) return null;
      return s.last_updated;
    }).join('|');

    if (snapshot === this._lastStateSnapshot) {
      return false;
    }
    this._lastStateSnapshot = snapshot;
    return true;
  }

  get hass() {
    return this._hass;
  }

  _autoDiscover(hass) {
    const states = hass.states;
    const prefix = 'sensor.precipitation_radial_';

    // Find entities by suffix pattern
    const suffixes = {
      entity_minutely: 'minutely_forecast',
      entity_hourly: 'hourly_forecast',
      entity_current_temperature: 'current_apparent_temperature',
      entity_high_temperature: 'today_high_temperature',
      entity_low_temperature: 'today_low_temperature',
      entity_wind_speed: 'current_wind_speed',
    };

    let allFound = true;
    for (const [configKey, suffix] of Object.entries(suffixes)) {
      if (this._config[configKey]) continue; // already set explicitly

      // Search for an entity matching the suffix
      const match = Object.keys(states).find(
        (eid) => eid.startsWith(prefix) && eid.endsWith(suffix)
      );
      if (match) {
        this._config[configKey] = match;
      } else {
        allFound = false;
      }
    }
    this._resolved = allFound;
  }

  _isPrecip(dataPoint, probThreshold = 0.10, intensityThreshold = 0.005) {
    if (!dataPoint) return false;
    const intensity = parseFloat(dataPoint.precipIntensity) || 0;
    const probability = parseFloat(dataPoint.precipProbability) || 0;
    return intensity >= intensityThreshold && probability >= probThreshold;
  }

  _localize(key, fallback, replacements = {}) {
    let localizedString;
    let processedByHass = false;

    if (this._hass && typeof this._hass.localize === 'function') {
      try {
        localizedString = this._hass.localize(key, replacements);
        if (localizedString && localizedString !== key) {
          processedByHass = true;
        }
      } catch {
        localizedString = null;
      }
    }

    if (!processedByHass) {
      localizedString = fallback;
    }

    if (typeof localizedString === 'string' && replacements) {
      Object.keys(replacements).forEach((rKey) => {
        const val = replacements[rKey] !== undefined && replacements[rKey] !== null ? String(replacements[rKey]) : '';
        localizedString = localizedString.replace(new RegExp(`{${rKey}}`, 'g'), val);
      });
    }
    return typeof localizedString === 'string' ? localizedString : fallback;
  }

  _getPrecipTypeFromIcon(iconKey) {
    if (!iconKey || typeof iconKey !== 'string') {
      return this._localize('ui.card.weather.precipitation', 'Precipitation');
    }
    if (iconKey.includes('snow')) return this._localize('ui.card.weather.snow', 'Snow');
    if (iconKey.includes('sleet')) return this._localize('ui.card.weather.sleet', 'Sleet');
    if (iconKey.includes('rain') || iconKey.includes('thunderstorm') || iconKey.includes('hail')) return this._localize('ui.card.weather.rain', 'Rain');
    return this._localize('ui.card.weather.precipitation', 'Precipitation');
  }

  _getIntensityDescription(intensity, precipType = 'Rain') {
    const typeStr = typeof precipType === 'string' ? precipType : this._getPrecipTypeFromIcon(null);

    if (intensity >= 0.8) return `${this._localize('ui.card.weather.precipitation_very_heavy', 'Very Heavy')} ${typeStr}`;
    if (intensity >= 0.5) return `${this._localize('ui.card.weather.precipitation_heavy', 'Heavy')} ${typeStr}`;
    if (intensity >= 0.2) return `${this._localize('ui.card.weather.precipitation_moderate', 'Moderate')} ${typeStr}`;
    if (intensity > 0.005) return `${this._localize('ui.card.weather.precipitation_light', 'Light')} ${typeStr}`;
    return typeStr;
  }

  _getCombinedWeatherSummary(minutelyData, hourlyData) {
    let actualStartsIn = -1;
    let actualSpellDuration = -1;
    let actualEndsIn = -1;
    let isCurrentlyPrecipitating = false;
    let maxIntensityMinutely = 0;

    const firstHourIconKey = hourlyData?.[0]?.icon || '';
    let currentPrecipType = this._getPrecipTypeFromIcon(firstHourIconKey);

    if (minutelyData && minutelyData.length > 0) {
      if (this._isPrecip(minutelyData[0])) {
        isCurrentlyPrecipitating = true;
        maxIntensityMinutely = Math.max(maxIntensityMinutely, parseFloat(minutelyData[0].precipIntensity) || 0);
      }

      let firstPrecipMinuteInSpell = -1;
      let lastPrecipMinuteInSpell = -1;

      for (let i = 0; i < minutelyData.length; i++) {
        if (this._isPrecip(minutelyData[i])) {
          if (firstPrecipMinuteInSpell === -1) {
            firstPrecipMinuteInSpell = i;
          }
          lastPrecipMinuteInSpell = i;
          maxIntensityMinutely = Math.max(maxIntensityMinutely, parseFloat(minutelyData[i].precipIntensity) || 0);

          if (isCurrentlyPrecipitating && actualEndsIn === -1) {
            let drySpellFound = true;
            for (let k = 0; k < 5; k++) {
              const checkIdx = i + 1 + k;
              // Past end of data counts as dry (rain ended within the window)
              if (checkIdx >= minutelyData.length) break;
              if (this._isPrecip(minutelyData[checkIdx])) {
                drySpellFound = false;
                break;
              }
            }
            if (drySpellFound) {
              actualEndsIn = i + 1;
            } else if (i === minutelyData.length - 1) {
              actualEndsIn = minutelyData.length;
            }
          }
        } else {
          if (firstPrecipMinuteInSpell !== -1) {
            if (!isCurrentlyPrecipitating && actualStartsIn === -1) {
              actualStartsIn = firstPrecipMinuteInSpell;
              actualSpellDuration = (lastPrecipMinuteInSpell - firstPrecipMinuteInSpell) + 1;
            }
            firstPrecipMinuteInSpell = -1;
          }
        }
      }

      if (firstPrecipMinuteInSpell !== -1) {
          if (!isCurrentlyPrecipitating && actualStartsIn === -1) {
            actualStartsIn = firstPrecipMinuteInSpell;
            actualSpellDuration = (lastPrecipMinuteInSpell - firstPrecipMinuteInSpell) + 1;
          } else if (isCurrentlyPrecipitating && actualEndsIn === -1) {
            actualEndsIn = minutelyData.length;
          }
      }
    }

    const intensityDesc = this._getIntensityDescription(maxIntensityMinutely, currentPrecipType);

    if (isCurrentlyPrecipitating) {
      if (actualEndsIn !== -1 && actualEndsIn > 0) {
        return this._localize('ui.card.precipitation_radial.precip_ending_in', `${intensityDesc} ending in {actual_ends_in} min`, {actual_ends_in: actualEndsIn});
      }
      return this._localize('ui.card.precipitation_radial.precip_ongoing', `${intensityDesc} ongoing`, {});
    }

    if (actualStartsIn !== -1 && actualStartsIn >= 0) {
      let msg = this._localize('ui.card.precipitation_radial.precip_starting_in', `${intensityDesc} starting in {actual_starts_in} min`, {
        actual_starts_in: actualStartsIn
      });
      if (actualSpellDuration !== -1 && actualSpellDuration > 0) {
        msg += this._localize('ui.card.precipitation_radial.precip_for_duration', `, for {actual_spell_duration} min`, {
          actual_spell_duration: actualSpellDuration
        });
      }
      return msg;
    }

    // Fallback: if any minutely data point would show as colored on the ring,
    // mention precipitation even if the spell detection didn't find a clean pattern
    if (minutelyData && minutelyData.length > 0) {
      let hasAnyPrecip = false;
      let maxFallbackIntensity = 0;
      let firstPrecipIdx = -1;
      let lastPrecipIdx = -1;
      for (let i = 0; i < minutelyData.length; i++) {
        if (this._isPrecip(minutelyData[i])) {
          hasAnyPrecip = true;
          const inten = parseFloat(minutelyData[i].precipIntensity) || 0;
          if (inten > maxFallbackIntensity) maxFallbackIntensity = inten;
          if (firstPrecipIdx === -1) firstPrecipIdx = i;
          lastPrecipIdx = i;
        }
      }
      if (hasAnyPrecip) {
        const fallbackDesc = this._getIntensityDescription(maxFallbackIntensity, currentPrecipType);
        if (firstPrecipIdx === 0) {
          return `${fallbackDesc} expected`;
        }
        return this._localize('ui.card.precipitation_radial.precip_starting_in', `${fallbackDesc} starting in {actual_starts_in} min`, {
          actual_starts_in: firstPrecipIdx
        });
      }
    }

    const weatherCondition = hourlyData?.[0]?.summary || this._localize('ui.card.weather.unavailable', 'Weather data unavailable');
    return weatherCondition;
  }

  _getCurrentOverallIconKey(minutelyData, hourlyData) {
    const currentHourIconKey = hourlyData?.[0]?.icon || '';
    const hasMinutelyPrecip = minutelyData?.slice(0, 15).some(d => this._isPrecip(d));

    if (hasMinutelyPrecip) {
      const precipIconKeys = ['rain', 'snow', 'sleet', 'hail', 'thunderstorm'];
      for (const type of precipIconKeys) {
        if (currentHourIconKey.includes(type)) {
          return type;
        }
      }
      return 'rain';
    }
    return this._iconMap[currentHourIconKey] ? currentHourIconKey : 'cloudy';
  }

  _formatHourAmPm(hour24) {
    if (hour24 === null || typeof hour24 === 'undefined') return "";
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    const ampm = hour24 < 12 || hour24 === 24 ? 'am' : 'pm';
    if (hour24 === 0) return '12a';
    if (hour24 === 12) return '12p';
    return `${hour12}${ampm.substring(0,1)}`;
  }

  _getColorForPrecip(intensity = 0, probability = 0) {
    const numIntensity = parseFloat(intensity) || 0;
    const numProbability = parseFloat(probability) || 0;

    if (numProbability < 0.10 || numIntensity < 0.005) {
        return 'var(--disabled-text-color, #cccccc)';
    }

    if (numIntensity < 0.01) return '#AED581';
    if (numIntensity < 0.05) return '#9CCC65';
    if (numIntensity < 0.15) return '#66BB6A';
    if (numIntensity < 0.30) return '#FFEE58';
    if (numIntensity < 0.60) return '#FFCA28';
    if (numIntensity < 1.0) return '#FF7043';
    return '#E53935';
  }

  _updateCard(hass) {
    const config = this._config;
    if (!hass || !config) return;

    const shadowRoot = this.shadowRoot;

    // If entities aren't resolved yet, show waiting message
    if (!this._resolved) {
      shadowRoot.innerHTML = `
        <ha-card>
          <div style="padding: 16px; text-align: center; color: var(--secondary-text-color);">
            <ha-icon icon="mdi:weather-cloudy-clock" style="margin-bottom: 8px;"></ha-icon>
            <div>Waiting for Precipitation Radial entities...</div>
            <div style="font-size: 0.85em; margin-top: 4px;">Add the Precipitation Radial integration first.</div>
          </div>
        </ha-card>
      `;
      return;
    }

    const entityMinutely = hass.states[config.entity_minutely];
    const entityHourly = hass.states[config.entity_hourly];
    const minutelyData = entityMinutely?.attributes?.data || [];
    const hourlyData = entityHourly?.attributes?.data || [];

    const currentTempRaw = hass.states[config.entity_current_temperature]?.state;
    const currentTemp = currentTempRaw && !['unavailable', 'unknown'].includes(currentTempRaw)
      ? parseFloat(currentTempRaw).toFixed(1) : 'N/A';

    const highTempRaw = hass.states[config.entity_high_temperature]?.state;
    const highTemp = highTempRaw && !['unavailable', 'unknown'].includes(highTempRaw)
      ? Math.round(parseFloat(highTempRaw)).toString() : 'N/A';

    const lowTempRaw = hass.states[config.entity_low_temperature]?.state;
    const lowTemp = lowTempRaw && !['unavailable', 'unknown'].includes(lowTempRaw)
      ? Math.round(parseFloat(lowTempRaw)).toString() : 'N/A';

    const windSpeedRaw = hass.states[config.entity_wind_speed]?.state;
    const windSpeed = windSpeedRaw && !['unavailable', 'unknown'].includes(windSpeedRaw)
      ? Math.round(parseFloat(windSpeedRaw)).toString() : 'N/A';

    const tempUnitRaw = hass.states[config.entity_current_temperature]?.attributes?.unit_of_measurement;
    const tempUnit = typeof tempUnitRaw === 'string' ? tempUnitRaw : '';
    const windUnit = hass.states[config.entity_wind_speed]?.attributes?.unit_of_measurement || '';

    const locationName = entityMinutely?.attributes?.location_name || '';

    const overallIconKey = this._getCurrentOverallIconKey(minutelyData, hourlyData);
    const weatherMdiIcon = this._iconMap[overallIconKey] || this._iconMap['cloudy'];

    let combinedSummary;
    try {
      combinedSummary = this._getCombinedWeatherSummary(minutelyData, hourlyData);
    } catch (e) {
      console.error('Precipitation Radial: error generating summary', e);
      combinedSummary = hourlyData?.[0]?.summary || 'Weather data unavailable';
    }

    shadowRoot.innerHTML = '';

    const haCard = document.createElement('ha-card');

    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
      }
      ha-card {
        padding: clamp(8px, 3cqi, 16px);
        box-sizing: border-box;
        font-family: var(--primary-font-family, sans-serif);
        container-type: inline-size;
      }
      .card-container {
        position: relative;
        width: 100%;
        max-width: 350px;
        margin: 0 auto;
        aspect-ratio: 1;
      }
      .svg-and-text-wrapper {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
      }
      .svg-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
      }
      .center-text-container {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        text-align: center;
        width: 48%;
        color: var(--primary-text-color, #333);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
      }
      .summary-icon {
        margin-bottom: 0.1em;
        color: var(--primary-text-color, #333);
      }
      .summary-icon ha-icon {
        font-size: clamp(1.2em, 6cqi, 2em);
      }
      .summary-text {
        font-size: clamp(0.7em, 4cqi, 1.1em);
        font-weight: bold;
        line-height: 1.2;
        margin-bottom: 0.2em;
        color: var(--primary-text-color, #333);
      }
      .detail-text {
        font-size: clamp(0.55em, 3cqi, 0.85em);
        line-height: 1.25;
        margin-top: 0.3em;
        color: var(--secondary-text-color, #555);
      }
      .hour-label,
      .minute-label {
        fill: #000000;
        text-anchor: middle;
        dominant-baseline: middle;
        paint-order: stroke;
        stroke: #FFFFFF;
        stroke-width: 0.8px;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .minute-label {
        font-size: 2.8px;
      }
      .hour-label {
        font-size: 3.2px;
      }
      .location-label {
        position: absolute;
        top: clamp(2px, 1cqi, 6px);
        left: clamp(4px, 2cqi, 10px);
        font-size: clamp(0.5em, 2.5cqi, 0.75em);
        color: var(--secondary-text-color, #888);
        line-height: 1.2;
        z-index: 1;
        pointer-events: none;
      }
      .minute-tick {
        stroke: var(--primary-text-color, #000000);
        stroke-width: 0.7px;
        stroke-linecap: round;
      }
    `;
    haCard.appendChild(style);

    const cardContainer = document.createElement('div');
    cardContainer.className = 'card-container';

    if (locationName) {
      const locLabel = document.createElement('div');
      locLabel.className = 'location-label';
      locLabel.textContent = locationName;
      cardContainer.appendChild(locLabel);
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'svg-and-text-wrapper';

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.classList.add("svg-container");

    const centerX = 50, centerY = 50;
    const minuteRingRadius = 30;
    const barWidth = 4.5;
    const minuteTickLength = barWidth * 0.5;

    const baseMinuteRing = document.createElementNS(svgNS, "circle");
    baseMinuteRing.setAttribute("cx", centerX);
    baseMinuteRing.setAttribute("cy", centerY);
    baseMinuteRing.setAttribute("r", minuteRingRadius - barWidth / 2);
    baseMinuteRing.setAttribute("stroke", "var(--divider-color, #e0e0e0)");
    baseMinuteRing.setAttribute("stroke-width", barWidth);
    baseMinuteRing.setAttribute("fill", "none");
    svg.appendChild(baseMinuteRing);

    minutelyData.slice(0, 60).forEach((minute, i) => {
      const angle = ((i - 15) / 60) * 2 * Math.PI;
      const x1 = centerX + (minuteRingRadius - barWidth) * Math.cos(angle);
      const y1 = centerY + (minuteRingRadius - barWidth) * Math.sin(angle);
      const x2 = centerX + minuteRingRadius * Math.cos(angle);
      const y2 = centerY + minuteRingRadius * Math.sin(angle);

      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", x1);
      line.setAttribute("y1", y1);
      line.setAttribute("x2", x2);
      line.setAttribute("y2", y2);
      line.setAttribute("stroke-width", barWidth + 0.5);
      line.setAttribute("stroke-linecap", "butt");
      line.setAttribute("stroke", this._getColorForPrecip(minute.precipIntensity, minute.precipProbability));
      svg.appendChild(line);
    });

    const minutesToLabel = [0, 10, 20, 30, 40, 50];
    minutesToLabel.forEach(minuteOffset => {
      if (minuteOffset < 60) {
        const angle = ((minuteOffset - 15) / 60) * 2 * Math.PI;

        const x1_tick = centerX + (minuteRingRadius - minuteTickLength / 2) * Math.cos(angle);
        const y1_tick = centerY + (minuteRingRadius - minuteTickLength / 2) * Math.sin(angle);
        const x2_tick = centerX + (minuteRingRadius + minuteTickLength / 2) * Math.cos(angle);
        const y2_tick = centerY + (minuteRingRadius + minuteTickLength / 2) * Math.sin(angle);

        const tickLine = document.createElementNS(svgNS, "line");
        tickLine.setAttribute("x1", x1_tick);
        tickLine.setAttribute("y1", y1_tick);
        tickLine.setAttribute("x2", x2_tick);
        tickLine.setAttribute("y2", y2_tick);
        tickLine.classList.add("minute-tick");
        svg.appendChild(tickLine);

        const labelRadius = minuteRingRadius - (barWidth / 2);
        const labelX = centerX + labelRadius * Math.cos(angle);
        const labelY = centerY + labelRadius * Math.sin(angle);
        const minuteText = document.createElementNS(svgNS, "text");
        minuteText.setAttribute("x", labelX);
        minuteText.setAttribute("y", labelY);
        minuteText.classList.add("minute-label");
        minuteText.textContent = minuteOffset.toString();
        svg.appendChild(minuteText);
      }
    });

    const hourRingRadius = minuteRingRadius + barWidth + 8;
    const hourNow = new Date().getHours();
    const hourTickRadius = 3.2;
    const hourLabelRadius = hourRingRadius;

    for (let clockPosIdx = 0; clockPosIdx < 12; clockPosIdx++) {
      const angleBase = ((clockPosIdx - 3) / 12) * 2 * Math.PI;
      const baseX = centerX + hourRingRadius * Math.cos(angleBase);
      const baseY = centerY + hourRingRadius * Math.sin(angleBase);

      const baseTick = document.createElementNS(svgNS, "circle");
      baseTick.setAttribute("cx", baseX);
      baseTick.setAttribute("cy", baseY);
      baseTick.setAttribute("r", hourTickRadius * 0.7);
      baseTick.setAttribute("fill", "var(--divider-color, #e0e0e0)");
      svg.appendChild(baseTick);
    }

    for (let forecastIdx = 0; forecastIdx < Math.min(hourlyData.length, 12); forecastIdx++) {
      const data = hourlyData[forecastIdx];
      if (!data) continue;

      const actualForecastHour = (hourNow + forecastIdx) % 24;
      let clockPosForThisForecast = actualForecastHour % 12;

      const angleForThisForecast = ((clockPosForThisForecast - 3) / 12) * 2 * Math.PI;

      const tickX = centerX + hourRingRadius * Math.cos(angleForThisForecast);
      const tickY = centerY + hourRingRadius * Math.sin(angleForThisForecast);

      const precipTick = document.createElementNS(svgNS, "circle");
      precipTick.setAttribute("cx", tickX);
      precipTick.setAttribute("cy", tickY);
      precipTick.setAttribute("r", hourTickRadius);
      precipTick.setAttribute("fill", this._getColorForPrecip(data.precipIntensity, data.precipProbability));
      svg.appendChild(precipTick);

      const labelX = centerX + hourLabelRadius * Math.cos(angleForThisForecast);
      const labelY = centerY + hourLabelRadius * Math.sin(angleForThisForecast);
      const hourText = document.createElementNS(svgNS, "text");
      hourText.setAttribute("x", labelX);
      hourText.setAttribute("y", labelY);
      hourText.classList.add("hour-label");
      hourText.textContent = this._formatHourAmPm(actualForecastHour);
      svg.appendChild(hourText);
    }

    wrapper.appendChild(svg);

    const textContainer = document.createElement("div");
    textContainer.className = "center-text-container";
    const cleanTempUnit = typeof tempUnit === 'string' ? tempUnit.replace(/°/g, '') : '';
    const cleanCurrentTemp = typeof currentTemp === 'string' ? currentTemp.replace(/°/g, '') : currentTemp;

    textContainer.innerHTML = `
      <div class="summary-icon">
        <ha-icon icon="${weatherMdiIcon}"></ha-icon>
      </div>
      <div class="summary-text">
        ${combinedSummary}
      </div>
      <div class="detail-text">
        Current: ${cleanCurrentTemp}\u00B0${cleanTempUnit}<br>
        High: ${String(highTemp).replace(/°/g, '')}\u00B0 / Low: ${String(lowTemp).replace(/°/g, '')}\u00B0<br>
        Wind: ${windSpeed} ${windUnit}
      </div>
    `;
    wrapper.appendChild(textContainer);
    cardContainer.appendChild(wrapper);
    haCard.appendChild(cardContainer);
    shadowRoot.appendChild(haCard);
  }

  getCardSize() {
    return 6;
  }
}

customElements.define('precipitation-radial-card', PrecipitationRadialCard);

// Register with HA card picker
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'precipitation-radial-card',
  name: 'Precipitation Radial Card',
  description: 'A clock-style radial precipitation forecast card using PirateWeather data.',
  preview: false,
});
