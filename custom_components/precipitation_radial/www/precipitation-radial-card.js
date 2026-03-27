class PrecipitationRadialCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._resolved = false;
    this._lastStateSnapshot = null;
    this._rafId = null;
    this._animRunning = false;
    this._animCanvas = null;
    this._animCtx = null;
    this._canvasW = 0;
    this._canvasH = 0;
    this._resizeObserver = null;
    this._particles = [];
    this._particleConfig = null;
    this._conditionKey = '';
    this._overlayConditionKey = null;
    this._lastFrameTime = 0;
    this._lightningBolts = [];
    this._nextStrikeTime = 0;
    this._iconMap = {
      'clear-day': 'wi-sunny',
      'clear-night': 'wi-moon',
      'rain': 'wi-rainy',
      'snow': 'wi-snowy',
      'sleet': 'wi-sleet',
      'wind': 'wi-windy',
      'fog': 'wi-fog',
      'cloudy': 'wi-cloudy',
      'partly-cloudy-day': 'wi-partly-cloudy-day',
      'partly-cloudy-night': 'wi-partly-cloudy-night',
      'hail': 'wi-hail',
      'thunderstorm': 'wi-thundery',
      'sunny': 'wi-sunny',
      'mostly_sunny': 'wi-sunny',
      'partly_sunny': 'wi-partly-cloudy-day',
      'mostly_cloudy': 'wi-cloudy',
      'chance_of_rain': 'wi-rainy',
      'showers': 'wi-rainy',
    };
  }

  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    if (!config) config = {};
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
        // If rain extends to end of minutely window, check hourly data for duration
        if (actualEndsIn >= minutelyData.length - 1 && hourlyData && hourlyData.length > 1) {
          // Count consecutive hours with precipitation starting from hour 1
          // (hour 0 overlaps with the minutely window)
          let rainyHours = 1; // at least 1 hour (the minutely window)
          for (let h = 1; h < hourlyData.length; h++) {
            if (this._isPrecip(hourlyData[h])) {
              rainyHours++;
            } else {
              break;
            }
          }
          if (rainyHours >= 2) {
            return `${intensityDesc} expected for the next ${rainyHours} hours`;
          }
        }
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

  _getCurrentConditions(minutelyData, hourlyData) {
    const currentHourIconKey = hourlyData?.[0]?.icon || '';
    // Sky condition from hourly icon (what the sky looks like)
    const sky = this._iconMap[currentHourIconKey] ? currentHourIconKey : 'cloudy';

    // Precipitation condition from minutely data (what's falling)
    const recentMinutely = minutelyData?.slice(0, 15) || [];
    const precipMinutes = recentMinutely.filter(d => this._isPrecip(d));
    let precip = null;

    if (precipMinutes.length > 0) {
      const typeCounts = {};
      for (const d of precipMinutes) {
        const pt = (d.precipType || 'rain').toLowerCase();
        typeCounts[pt] = (typeCounts[pt] || 0) + 1;
      }
      let dominant = 'rain';
      let maxCount = 0;
      for (const [type, count] of Object.entries(typeCounts)) {
        if (count > maxCount && type !== 'none') { dominant = type; maxCount = count; }
      }
      if (currentHourIconKey.includes('thunderstorm')) precip = 'thunderstorm';
      else if (dominant === 'snow') precip = 'snow';
      else if (dominant === 'sleet') precip = 'sleet';
      else if (dominant === 'hail') precip = 'hail';
      else precip = 'rain';
    }

    return { sky, precip };
  }

  // Keep for icon display — picks the most relevant single condition
  _getCurrentOverallIconKey(minutelyData, hourlyData) {
    const { sky, precip } = this._getCurrentConditions(minutelyData, hourlyData);
    return precip || sky;
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

  disconnectedCallback() {
    this._stopAnimation();
  }

  _stopAnimation() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._animRunning = false;
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    this._animCanvas = null;
    this._animCtx = null;
    this._canvasW = 0;
    this._canvasH = 0;
    this._particles = [];
    this._particleConfig = null;
  }

  _handleLocateMe(iconEl) {
    iconEl.classList.add('locating');

    // Strategy 1: Try to get location from HA state (instant)
    const coords = this._getLocationFromHA();
    if (coords) {
      this._applyLocation(iconEl, coords.lat, coords.lon, coords.source);
      return;
    }

    // Strategy 2: Fall back to browser geolocation
    this._browserGeolocation(iconEl);
  }

  _getLocationFromHA() {
    if (!this._hass) return null;
    const states = this._hass.states;
    const userId = this._hass.user?.id;

    // Build set of device trackers that belong to the current user (via person entity)
    const userTrackers = new Set();
    if (userId) {
      for (const entityId of Object.keys(states)) {
        if (!entityId.startsWith('person.')) continue;
        const state = states[entityId];
        if (state.attributes.user_id === userId) {
          (state.attributes.device_trackers || []).forEach(t => userTrackers.add(t));
        }
      }
    }

    // Try matching current device via user agent string
    // Mobile browsers include device model: "Pixel 9 Pro", "SM-X218U", etc.
    // Only consider trackers belonging to the current user; pick longest (most specific) match
    const ua = navigator.userAgent.toLowerCase().replace(/[^a-z0-9]/g, '');
    let bestMatch = null;
    let bestLen = 0;
    for (const entityId of Object.keys(states)) {
      if (!entityId.startsWith('device_tracker.')) continue;
      if (userTrackers.size > 0 && !userTrackers.has(entityId)) continue;
      const state = states[entityId];
      if (state.attributes.latitude == null || state.attributes.longitude == null) continue;
      const suffix = entityId.replace('device_tracker.', '').replace(/[^a-z0-9]/g, '');
      if (suffix.length >= 4 && ua.includes(suffix) && suffix.length > bestLen) {
        bestMatch = { lat: state.attributes.latitude, lon: state.attributes.longitude, source: entityId };
        bestLen = suffix.length;
      }
    }
    if (bestMatch) return bestMatch;

    // Fall back to person entity location (uses most recently updated tracker)
    if (userId) {
      for (const entityId of Object.keys(states)) {
        if (!entityId.startsWith('person.')) continue;
        const state = states[entityId];
        if (state.attributes.user_id === userId &&
            state.attributes.latitude != null && state.attributes.longitude != null) {
          return {
            lat: state.attributes.latitude,
            lon: state.attributes.longitude,
            source: state.attributes.source || entityId,
          };
        }
      }
    }

    return null;
  }

  _applyLocation(iconEl, lat, lon, source) {
    const roundedLat = Math.round(lat * 1000000) / 1000000;
    const roundedLon = Math.round(lon * 1000000) / 1000000;
    if (!this._hass) { iconEl.classList.remove('locating'); return; }
    this._hass.callService('precipitation_radial', 'update_location', {
      latitude: roundedLat,
      longitude: roundedLon,
    }).then(() => {
      iconEl.classList.remove('locating');
      iconEl.setAttribute('icon', 'mdi:check-circle');
      console.info(`Precipitation Radial: location updated from ${source} (${roundedLat}, ${roundedLon})`);
      setTimeout(() => iconEl.setAttribute('icon', 'mdi:crosshairs-gps'), 2000);
    }).catch((err) => {
      console.error('Precipitation Radial: service call failed', err);
      iconEl.classList.remove('locating');
      iconEl.setAttribute('icon', 'mdi:alert-circle');
      setTimeout(() => iconEl.setAttribute('icon', 'mdi:crosshairs-gps'), 2000);
    });
  }

  _browserGeolocation(iconEl) {
    if (!navigator.geolocation || !window.isSecureContext) {
      console.warn('Precipitation Radial: browser geolocation unavailable');
      iconEl.classList.remove('locating');
      iconEl.setAttribute('icon', !window.isSecureContext ? 'mdi:lock-alert' : 'mdi:crosshairs-off');
      setTimeout(() => iconEl.setAttribute('icon', 'mdi:crosshairs-gps'), 2000);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => this._applyLocation(iconEl, pos.coords.latitude, pos.coords.longitude, 'browser geolocation'),
      (err) => {
        console.error('Precipitation Radial: geolocation error', err.code, err.message);
        iconEl.classList.remove('locating');
        iconEl.setAttribute('icon', err.code === 1 ? 'mdi:crosshairs-off' : 'mdi:alert-circle');
        setTimeout(() => iconEl.setAttribute('icon', 'mdi:crosshairs-gps'), 2000);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  _mapConditionForAnimation(iconKey) {
    const aliases = {
      'sunny': null,
      'mostly_sunny': null,
      'partly_sunny': 'partly-cloudy',
      'mostly_cloudy': 'cloudy',
      'chance_of_rain': 'rain',
      'showers': 'rain',
      'clear-day': null,
      'clear-night': null,
      'partly-cloudy-day': 'partly-cloudy',
      'partly-cloudy-night': 'partly-cloudy',
    };
    if (iconKey in aliases) return aliases[iconKey];
    return iconKey;
  }

  _getConditionGradient(conditionKey) {
    const dark = this._darkMode !== false;
    const a1 = dark ? 0.20 : 0.12;
    const a2 = dark ? 0.10 : 0.06;
    const gradients = {
      'rain': `radial-gradient(ellipse at 50% 0%, rgba(60,110,185,${a1}) 0%, rgba(45,85,155,${a2}) 60%, transparent 100%)`,
      'snow': `radial-gradient(ellipse at 50% 0%, rgba(200,220,240,${a1}) 0%, rgba(180,200,230,${a2}) 60%, transparent 100%)`,
      'sleet': `radial-gradient(ellipse at 50% 0%, rgba(100,130,180,${a1 * 0.9}) 0%, rgba(80,100,140,${a2 * 0.8}) 60%, transparent 100%)`,
      'hail': `radial-gradient(ellipse at 50% 0%, rgba(140,160,190,${a1 * 1.1}) 0%, rgba(100,120,150,${a2}) 60%, transparent 100%)`,
      'thunderstorm': `radial-gradient(ellipse at 50% 30%, rgba(60,50,120,${a1 * 1.4}) 0%, rgba(40,30,80,${a2 * 1.5}) 60%, transparent 100%)`,
      'fog': `radial-gradient(ellipse at 50% 50%, rgba(180,180,180,${a1 * 0.9}) 0%, rgba(160,160,160,${a2}) 70%, transparent 100%)`,
      'partly-cloudy': `radial-gradient(ellipse at 50% 30%, rgba(180,180,180,${a1 * 0.3}) 0%, rgba(160,160,160,${a2 * 0.3}) 70%, transparent 100%)`,
      'cloudy': `radial-gradient(ellipse at 50% 30%, rgba(180,180,180,${a1 * 0.6}) 0%, rgba(160,160,160,${a2 * 0.6}) 70%, transparent 100%)`,
      'wind': `linear-gradient(90deg, rgba(100,150,200,${a1 * 0.6}) 0%, rgba(80,130,180,${a2 * 0.6}) 50%, transparent 100%)`,
    };
    return gradients[conditionKey] || 'none';
  }

  _createGradientLayer(container, conditionKey) {
    const gradient = this._getConditionGradient(conditionKey);
    if (gradient === 'none') return;
    const div = document.createElement('div');
    div.className = 'animation-gradient';
    div.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;border-radius:inherit;background:${gradient};`;
    container.appendChild(div);
  }

  _getCSSParticleConfig(conditionKey, intensityFactor = 0) {
    const t = intensityFactor;
    const lerp = (lo, hi) => Math.round(lo + (hi - lo) * t);
    const lerpF = (lo, hi) => lo + (hi - lo) * t;

    const configs = {
      'rain':          { count: lerp(5, 24),  type: 'drop',  durationRange: [lerpF(1.2, 0.5), lerpF(1.8, 0.8)],  sizeRange: [lerpF(0.5, 1.5), lerpF(1.5, 3.5)] },
      'snow':          { count: lerp(4, 20),  type: 'flake', durationRange: [lerpF(5.0, 2.0), lerpF(7.0, 3.5)],  sizeRange: [lerpF(1.5, 2.5), lerpF(3, 6)] },
      'sleet':         { count: lerp(5, 20),  type: 'mixed', durationRange: [lerpF(2.0, 0.7), lerpF(3.0, 1.5)],  sizeRange: [lerpF(0.5, 1.5), lerpF(2.5, 4.5)] },
      'hail':          { count: lerp(4, 16),  type: 'hail',  durationRange: [lerpF(0.8, 0.3), lerpF(1.2, 0.6)],  sizeRange: [lerpF(1.5, 2.5), lerpF(3, 5)] },
      'thunderstorm':  { count: lerp(8, 28),  type: 'drop',  durationRange: [lerpF(0.9, 0.3), lerpF(1.4, 0.6)],  sizeRange: [lerpF(1, 1.5), lerpF(2, 4)] },
      'fog':           { count: 8,            type: 'fog',   durationRange: [10.0, 18.0], sizeRange: [70, 130] },
      'partly-cloudy': { count: 3,            type: 'cloud', durationRange: [14.0, 22.0], sizeRange: [40, 65] },
      'cloudy':        { count: 6,            type: 'cloud', durationRange: [12.0, 20.0], sizeRange: [50, 80] },
      'wind':          { count: lerp(3, 8),   type: 'streak', durationRange: [lerpF(3.5, 1.5), lerpF(5.0, 2.5)], sizeRange: [20, 50] },
    };
    return configs[conditionKey] || null;
  }

  _createCSSAnimation(container, conditionKey, windSpeed, intensityFactor = 0) {
    const pConfig = this._getCSSParticleConfig(conditionKey, intensityFactor);
    if (!pConfig) return;

    // Wind uses SVG dash technique instead of CSS div animation
    if (pConfig.type === 'streak') {
      const wf = Math.max(0.3, intensityFactor);
      this._createWindSVGLayer(container, windSpeed, wf);
      return;
    }

    const layer = document.createElement('div');
    layer.className = 'animation-layer-css';
    layer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;pointer-events:none;border-radius:inherit;overflow:hidden;';

    const windDrift = Math.min((parseFloat(windSpeed) || 0) * 2, 30);

    for (let i = 0; i < pConfig.count; i++) {
      const div = document.createElement('div');
      const dur = pConfig.durationRange[0] + Math.random() * (pConfig.durationRange[1] - pConfig.durationRange[0]);
      const delay = -(Math.random() * dur);
      const size = pConfig.sizeRange[0] + Math.random() * (pConfig.sizeRange[1] - pConfig.sizeRange[0]);
      const left = Math.random() * 100;
      const opacity = 0.15 + Math.random() * 0.25;

      div.style.position = 'absolute';
      div.style.willChange = 'transform, opacity';
      div.style.animationTimingFunction = 'linear';
      div.style.animationIterationCount = 'infinite';
      div.style.animationDelay = `${delay.toFixed(2)}s`;
      div.style.animationDuration = `${dur.toFixed(2)}s`;
      div.style.setProperty('--drift', `${windDrift}px`);

      const t = pConfig.type === 'mixed' ? (i % 3 === 0 ? 'flake' : 'drop') : pConfig.type;
      const c = this._colors || this._getAnimColors();

      if (t === 'drop') {
        const [r,g,b] = c.cssDrop;
        div.style.left = `${left}%`;
        div.style.top = '-5%';
        div.style.width = `${size * 0.4}px`;
        div.style.height = `${size * 2.5}px`;
        div.style.borderRadius = `${size}px`;
        div.style.background = `rgba(${r},${g},${b},${opacity})`;
        div.style.animationName = 'anim-fall';
      } else if (t === 'flake') {
        const [r,g,b] = c.cssFlake;
        div.style.left = `${left}%`;
        div.style.top = '-5%';
        div.style.width = `${size}px`;
        div.style.height = `${size}px`;
        div.style.borderRadius = '50%';
        div.style.background = `rgba(${r},${g},${b},${opacity + 0.1})`;
        div.style.animationName = 'anim-fall';
        div.style.animationDuration = `${(dur * 1.5).toFixed(2)}s`;
      } else if (t === 'hail') {
        const [r,g,b] = c.cssHail;
        div.style.left = `${left}%`;
        div.style.top = '-5%';
        div.style.width = `${size}px`;
        div.style.height = `${size}px`;
        div.style.borderRadius = '50%';
        div.style.background = `rgba(${r},${g},${b},${opacity + 0.05})`;
        div.style.border = `0.5px solid rgba(${r},${g},${b},0.3)`;
        div.style.animationName = 'anim-fall';
      } else if (t === 'fog') {
        const [r,g,b] = c.cssFog;
        div.style.left = `${-15 + Math.random() * 80}%`;
        div.style.top = `${-10 + Math.random() * 80}%`;
        div.style.width = `${size}%`;
        div.style.height = `${size * 0.6}%`;
        div.style.borderRadius = '50%';
        div.style.background = `radial-gradient(ellipse, rgba(${r},${g},${b},${opacity * 0.6}) 0%, rgba(${r},${g},${b},0) 70%)`;
        div.style.filter = `blur(${size * 0.12}px)`;
        div.style.animationName = 'anim-drift-fog';
        div.style.animationTimingFunction = 'ease-in-out';
      } else if (t === 'streak') {
        const [sr,sg,sb] = c.cssStreak;
        // Horizontal wind line with partial loop at end
        const vbW = 200;
        const vbH = 60;
        const vbMidY = vbH / 2;
        const svgLineLen = vbW * 0.85;
        const loopFrac = 0.05 + Math.random() * 0.45;
        const loopArcLen = svgLineLen * loopFrac;
        const straightLen = svgLineLen - loopArcLen;
        const loopDir = Math.random() < 0.5 ? 1 : -1;
        const loopR = 3 + Math.random() * 10;
        const loopAng = Math.min(loopArcLen / loopR, Math.PI * 1.8);
        const startX = (vbW - svgLineLen) / 2;
        let pathD = `M${startX.toFixed(1)},${vbMidY}`;
        pathD += ` L${(startX + straightLen).toFixed(1)},${vbMidY}`;
        const cX = startX + straightLen;
        const cY = vbMidY + loopDir * loopR;
        const sa = -loopDir * Math.PI / 2;
        const ss = -loopDir;
        for (let j = 1; j <= 20; j++) {
          const a = sa + ss * loopAng * (j / 20);
          pathD += ` L${(cX + loopR * Math.cos(a)).toFixed(1)},${(cY + loopR * Math.sin(a)).toFixed(1)}`;
        }
        const svgMarkup = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${vbW} ${vbH}'><defs><linearGradient id='wg${i}' x1='0' y1='0' x2='1' y2='0'><stop offset='0%' stop-color='rgba(${sr},${sg},${sb},0)'/><stop offset='10%' stop-color='rgba(${sr},${sg},${sb},${opacity + 0.1})'/><stop offset='90%' stop-color='rgba(${sr},${sg},${sb},${opacity + 0.1})'/><stop offset='100%' stop-color='rgba(${sr},${sg},${sb},0)'/></linearGradient></defs><path d='${pathD}' fill='none' stroke='url(#wg${i})' stroke-width='1.2' stroke-linecap='round' stroke-linejoin='round'/></svg>`;
        div.style.left = '-10%';
        div.style.top = `${10 + Math.random() * 80}%`;
        div.style.width = '50%';
        div.style.height = '15%';
        div.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(svgMarkup)}")`;
        div.style.backgroundSize = '100% 100%';
        div.style.animationName = 'anim-streak';
      } else if (t === 'cloud') {
        const [cr,cg,cb] = c.cssCloud;
        const depth = Math.random();
        const cOp = (0.15 + 0.25 * (1 - depth)) * opacity;
        div.style.left = `${-30 + Math.random() * 20}%`;
        div.style.top = `${5 + Math.random() * 55}%`;
        div.style.width = `${size * (0.6 + 0.6 * (1 - depth))}%`;
        div.style.height = `${size * (0.4 + 0.3 * (1 - depth))}%`;
        div.style.zIndex = Math.round((1 - depth) * 10);
        const fill = `rgba(${cr},${cg},${cb},${cOp.toFixed(2)})`;
        const stroke = `rgba(${cr},${cg},${cb},${(cOp * 0.15).toFixed(3)})`;
        const svgCloud = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-50 -50 100 70'><circle cx='0' cy='0' r='22' fill='${fill}' stroke='${stroke}' stroke-width='0.5'/><circle cx='-14' cy='4' r='18' fill='${fill}' stroke='${stroke}' stroke-width='0.5'/><circle cx='14' cy='4' r='18' fill='${fill}' stroke='${stroke}' stroke-width='0.5'/><circle cx='0' cy='-11' r='15' fill='${fill}' stroke='${stroke}' stroke-width='0.5'/></svg>`;
        div.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(svgCloud)}")`;
        div.style.backgroundSize = 'contain';
        div.style.backgroundRepeat = 'no-repeat';
        div.style.backgroundPosition = 'center';
        const baseDur = 14 + depth * 10;
        div.style.animationDuration = `${baseDur + Math.random() * 4}s`;
        div.style.animationName = 'anim-drift-cloud';
      }

      layer.appendChild(div);
    }

    if (conditionKey === 'thunderstorm') {
      const flashInterval = 1.2 + (1 - intensityFactor) * 2.5;
      const flashCss = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,0);border-radius:inherit;pointer-events:none;';
      for (let f = 0; f < 4; f++) {
        const fl = document.createElement('div');
        fl.style.cssText = flashCss;
        const dur = flashInterval * (0.7 + f * 0.25);
        const delay = Math.random() * flashInterval + f * flashInterval * 0.2;
        fl.style.animation = `anim-flash ${dur.toFixed(1)}s ease-in-out infinite ${delay.toFixed(1)}s`;
        layer.appendChild(fl);
      }
    }

    container.appendChild(layer);
  }

  _getAnimColors() {
    if (this._darkMode !== false) {
      // Dark mode: lighter blues that read well on dark backgrounds
      return {
        drop: 'rgb(130,175,230)',
        flake: 'rgb(220,230,245)', flakeShadow: 'rgba(220,230,255,0.3)',
        hail: 'rgb(200,215,230)', hailStroke: 'rgba(180,200,220,0.5)',
        cloud: [170,175,190],
        fogcloud: [200,205,215],
        streak: [140,180,220],
        lightningGlow: [180,200,255], lightningCore: [255,255,255],
        flashOverlay: [255,255,255],
        cssDrop: [130,175,230], cssFlake: [220,230,245], cssHail: [200,215,230],
        cssFog: [200,205,210], cssCloud: [170,175,190], cssStreak: [140,180,220],
      };
    } else {
      // Light mode: gentle blues that stay visible on light backgrounds
      return {
        drop: 'rgb(50,100,175)',
        flake: 'rgb(100,120,150)', flakeShadow: 'rgba(80,100,140,0.3)',
        hail: 'rgb(90,110,140)', hailStroke: 'rgba(70,90,120,0.5)',
        cloud: [100,110,125],
        fogcloud: [110,115,130],
        streak: [80,130,185],
        lightningGlow: [100,120,180], lightningCore: [50,50,70],
        flashOverlay: [255,255,255],
        cssDrop: [50,100,175], cssFlake: [100,120,150], cssHail: [90,110,140],
        cssFog: [110,115,130], cssCloud: [100,110,125], cssStreak: [80,130,185],
      };
    }
  }

  _createCanvasAnimation(container, conditionKey, windSpeed, intensityFactor = 0, overlayCondition = null) {
    // Legacy compat — forward to stacked animation
    this._createStackedAnimation(container, {
      sky: conditionKey,
      precip: overlayCondition,
      windSpeed: parseFloat(windSpeed) || 0,
      windFactor: 0,
      intensityFactor,
    });
  }

  _createStackedAnimation(container, { sky, precip, windSpeed, windFactor, intensityFactor }) {
    const canvas = document.createElement('canvas');
    canvas.className = 'animation-canvas';
    canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;pointer-events:none;border-radius:inherit;';
    container.appendChild(canvas);

    this._animCanvas = canvas;
    this._conditionKey = sky || precip || 'none';
    this._overlayConditionKey = null;
    this._intensityFactor = intensityFactor;
    this._hasThunderstorm = (precip === 'thunderstorm');
    this._lastFrameTime = 0;
    this._lightningBolts = [];
    this._nextStrikeTime = 0;
    this._canvasW = 0;
    this._canvasH = 0;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width === 0 || height === 0) continue;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        this._canvasW = width;
        this._canvasH = height;
        this._animCtx = canvas.getContext('2d');
        this._animCtx.scale(dpr, dpr);
      }
    });
    this._resizeObserver.observe(canvas);

    this._particles = [];

    // Layer 1: Sky (clouds, fog) — no intensity scaling
    if (sky && sky !== 'wind') {
      this._addLayerParticles(sky, windSpeed, 0);
    }

    // Layer 2: Precipitation
    if (precip) {
      this._addLayerParticles(precip, windSpeed, intensityFactor);
    }

    // Sort so background clouds (higher depth) draw first, precipitation on top
    this._particles.sort((a, b) => (b.depth || 0) - (a.depth || 0));

    // Layer 3: Wind SVG overlay (independent of sky condition, or when sky is 'wind')
    const needsWind = windFactor > 0 || sky === 'wind';
    if (needsWind) {
      const wf = sky === 'wind' ? Math.max(windFactor, 0.5) : windFactor;
      this._createWindSVGLayer(container, windSpeed, wf);
    }

    this._animRunning = true;
    this._rafId = requestAnimationFrame((t) => this._animationTick(t));
  }

  _addLayerParticles(conditionKey, windSpeed, intensityFactor = 0) {
    const ws = parseFloat(windSpeed) || 0;
    const windDriftPx = Math.min(ws * 0.8, 15);
    const t = intensityFactor;
    const lerp = (lo, hi) => Math.round(lo + (hi - lo) * t);
    const lerpF = (lo, hi) => lo + (hi - lo) * t;

    const configs = {
      'rain':         { count: lerp(10, 50), types: ['drop'],  baseVy: [lerpF(80, 150), lerpF(150, 280)],   baseVx: windDriftPx },
      'snow':         { count: lerp(8, 40),  types: ['flake'], baseVy: [lerpF(12, 25), lerpF(30, 60)],      baseVx: windDriftPx * 0.5 },
      'sleet':        { count: lerp(8, 40),  types: ['drop', 'drop', 'flake'], baseVy: [lerpF(40, 80), lerpF(100, 180)], baseVx: windDriftPx },
      'hail':         { count: lerp(8, 35),  types: ['hail'],  baseVy: [lerpF(100, 180), lerpF(200, 330)],  baseVx: windDriftPx * 0.3 },
      'thunderstorm': { count: lerp(15, 60), types: ['drop'],  baseVy: [lerpF(120, 200), lerpF(250, 380)],  baseVx: windDriftPx },
      'partly-cloudy': { count: 5,            types: ['cloud'], baseVy: [0, 0], baseVx: 8 + windDriftPx * 0.3 },
      'cloudy':       { count: 12,           types: ['cloud'], baseVy: [0, 0], baseVx: 6 + windDriftPx * 0.3 },
      'wind':         { count: lerp(6, 16),  types: ['streak'], baseVy: [0, 2], baseVx: 60 + windDriftPx * 2 },
      'fog':          { count: 6,            types: ['fogcloud'], baseVy: [0, 0], baseVx: 3 },
    };

    const cfg = configs[conditionKey];
    if (!cfg) return;
    if (!this._particleConfig) this._particleConfig = cfg;

    for (let i = 0; i < cfg.count; i++) {
      const type = cfg.types[i % cfg.types.length];
      const p = {
        x: 0, y: 0, vx: 0, vy: 0,
        size: 0, opacity: 0, type,
        rotation: 0, wobble: 0, phase: Math.random() * Math.PI * 2,
        life: 0, maxLife: 0,
        _cfg: cfg,
      };
      this._resetParticle(p, true);
      this._particles.push(p);
    }
  }

  _addWindParticles(windSpeed, windFactor) {
    const ws = parseFloat(windSpeed) || 0;
    const windDriftPx = Math.min(ws * 0.8, 15);
    const count = Math.round(3 + windFactor * 13); // 3-16 streaks
    const baseVx = 60 + windDriftPx * 2;
    const cfg = { count, types: ['streak'], baseVy: [0, 2], baseVx };
    if (!this._particleConfig) this._particleConfig = cfg;

    for (let i = 0; i < count; i++) {
      const p = {
        x: 0, y: 0, vx: 0, vy: 0,
        size: 0, opacity: 0, type: 'streak',
        rotation: 0, wobble: 0, phase: Math.random() * Math.PI * 2,
        life: 0, maxLife: 0,
        _cfg: cfg,
      };
      this._resetParticle(p, true);
      this._particles.push(p);
    }
  }

  _createWindSVGLayer(container, windSpeed, windFactor) {
    const c = this._colors || this._getAnimColors();
    const [sr,sg,sb] = c.cssStreak || c.streak;
    const trackCount = 3 + Math.round(windFactor * 4); // 3-7 tracks

    const wrapper = document.createElement('div');
    wrapper.className = 'wind-field';

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 800 320');
    svg.setAttribute('preserveAspectRatio', 'none');

    for (let i = 0; i < trackCount; i++) {
      const baseY = (320 / (trackCount + 1)) * (i + 1);
      const y = Math.round(baseY + (Math.random() - 0.5) * 40);
      const loopX = Math.round(100 + Math.random() * 500);
      const dir = Math.random() < 0.5 ? -1 : 1; // -1=above, 1=below
      const w = 20 + Math.round(Math.random() * 35); // 20-55 loop width (varying sizes)
      const h = Math.round(w * 0.4); // compensate for 800×320 viewBox in ~square container

      // Cubic-bezier loop: horizontal line → smooth loop → continue
      const d = `M -100 ${y} L ${loopX} ${y} ` +
        `C ${loopX+w} ${y}, ${loopX+w} ${y+dir*h}, ${loopX+Math.round(w/2)} ${y+dir*h} ` +
        `C ${loopX} ${y+dir*h}, ${loopX} ${y}, ${loopX+w} ${y} ` +
        `L 900 ${y}`;

      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', d);
      path.classList.add('wind-line');
      path.style.stroke = `rgba(${sr},${sg},${sb},0.55)`;

      // Snake dash: visible segment + gap calibrated per track
      const snakeLen = 120 + Math.round(Math.random() * 80); // 120-200 visible
      const gap = 750 + Math.round(Math.random() * 250); // 750-1000 gap
      path.style.strokeDasharray = `${snakeLen} ${gap}`;
      path.style.strokeDashoffset = `${snakeLen + gap}`;

      // Duration: faster wind = shorter (2.5-5.5s range)
      const baseDur = 5.5 - windFactor * 3;
      const dur = baseDur + (Math.random() - 0.5) * 1.5;
      path.style.animationDuration = `${Math.max(1.5, dur).toFixed(1)}s`;
      path.style.animationDelay = `${(Math.random() * 3).toFixed(1)}s`;

      svg.appendChild(path);
    }

    wrapper.appendChild(svg);
    container.appendChild(wrapper);
  }

  _resetParticle(p, randomizeY = false) {
    const cfg = p._cfg || this._particleConfig;
    if (!cfg) return;
    const area = this._canvasW || 350;
    const areaH = this._canvasH || 350;
    const t = this._intensityFactor || 0;

    if (p.type === 'cloud') {
      p.depth = p.depth != null ? p.depth : Math.random(); // 0=front, 1=back
      p.x = randomizeY ? (Math.random() * (area + 160) - 80) : (-80 - Math.random() * 120);
      p.y = 10 + Math.random() * (areaH * 0.65);
      p.size = 15 + 30 * (1 - p.depth); // bigger in front
      p.vx = (cfg.baseVx + Math.random() * 3) * (0.4 + 0.8 * (1 - p.depth)); // faster in front
      p.vy = 0;
      p.opacity = 0.15 + 0.25 * (1 - p.depth); // more opaque in front
      p.life = 0;
      p.maxLife = 999999;
      return;
    }

    if (p.type === 'fogcloud') {
      p.x = Math.random() * area;
      p.y = Math.random() * areaH;
      p.vx = (Math.random() - 0.3) * cfg.baseVx + 1;
      p.vy = (Math.random() - 0.5) * 2;
      p.size = Math.min(area, areaH) * (0.25 + Math.random() * 0.3);
      p.opacity = 0.05 + Math.random() * 0.06;
      p.phase = Math.random() * Math.PI * 2;
      p.wobble = 0.3 + Math.random() * 0.4;
      p.life = 0;
      p.maxLife = 999999;
      return;
    }

    if (p.type === 'streak') {
      const lineLen = area / 2; // half the visual width
      p.lineLen = lineLen;
      p.x = randomizeY ? (-lineLen + Math.random() * (area + lineLen)) : -(lineLen + Math.random() * 30);
      p.y = 0.1 * areaH + Math.random() * 0.8 * areaH;
      p.vx = cfg.baseVx + Math.random() * 30;
      p.vy = 0;
      p.size = 1.2 + Math.random() * 0.6;
      p.opacity = 0.3 + Math.random() * 0.2;
      p.life = 0;
      p.maxLife = 999999;

      // Pre-compute shape: horizontal line + partial loop at end
      const loopFrac = 0.05 + Math.random() * 0.45; // loop is 5-50% of total length
      const loopArcLen = lineLen * loopFrac;
      const straightLen = lineLen - loopArcLen;
      const loopDir = Math.random() < 0.5 ? 1 : -1; // 1=below, -1=above
      const loopRadius = 6 + Math.random() * 18;
      const loopAngle = Math.min(loopArcLen / loopRadius, Math.PI * 1.8); // cap near full circle
      const pts = [];
      // Straight horizontal segment
      const nStraight = 20;
      for (let si = 0; si <= nStraight; si++) {
        pts.push({ x: (si / nStraight) * straightLen, y: 0 });
      }
      // Loop arc at the end
      const centerX = straightLen;
      const centerY = loopDir * loopRadius;
      const startAngle = -loopDir * Math.PI / 2;
      const sweepSign = -loopDir;
      const nLoop = Math.max(10, Math.round(loopAngle * 8));
      for (let li = 1; li <= nLoop; li++) {
        const a = startAngle + sweepSign * loopAngle * (li / nLoop);
        pts.push({
          x: centerX + loopRadius * Math.cos(a),
          y: centerY + loopRadius * Math.sin(a)
        });
      }
      p.shape = pts;
      return;
    }

    // Wind SVG layer (replaces canvas streak drawing)
    // Kept for reference — streak particles no longer drawn on canvas

    // Falling particles: drop, flake, hail — sizes and opacity scale with intensity
    p.x = Math.random() * (area + 50) - 25;
    p.y = randomizeY ? (Math.random() * areaH) : -(5 + Math.random() * 30);
    p.vy = cfg.baseVy[0] + Math.random() * (cfg.baseVy[1] - cfg.baseVy[0]);
    p.vx = cfg.baseVx + (Math.random() - 0.3) * 10;

    const sizeMul = 0.7 + t * 0.6;
    const opacityMul = 0.7 + t * 0.5;

    if (p.type === 'drop') {
      p.size = (0.8 + Math.random() * 2) * sizeMul;
      p.opacity = (0.15 + Math.random() * 0.2) * opacityMul;
    } else if (p.type === 'flake') {
      p.size = (1.2 + Math.random() * 2.5) * sizeMul;
      p.opacity = (0.15 + Math.random() * 0.25) * opacityMul;
      p.wobble = 15 + Math.random() * 20;
      p.phase = Math.random() * Math.PI * 2;
    } else if (p.type === 'hail') {
      p.size = (1.2 + Math.random() * 2) * sizeMul;
      p.opacity = (0.2 + Math.random() * 0.15) * opacityMul;
    }

    p.life = 0;
    p.maxLife = 999999;
    p.rotation = Math.random() * Math.PI * 2;
  }

  _animationTick(timestamp) {
    if (!this._animRunning) return;

    // ResizeObserver is async — canvas context may not be ready on the first frame
    if (!this._animCtx || !this._animCanvas || this._canvasW === 0 || this._canvasH === 0) {
      this._rafId = requestAnimationFrame((t) => this._animationTick(t));
      return;
    }

    const w = this._canvasW;
    const h = this._canvasH;

    const dt = this._lastFrameTime ? Math.min((timestamp - this._lastFrameTime) / 1000, 0.05) : 0.016;
    this._lastFrameTime = timestamp;

    const ctx = this._animCtx;
    ctx.clearRect(0, 0, w, h);

    for (const p of this._particles) {
      p.life += dt;

      if (p.type === 'fogcloud') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.x > w + p.size * 0.5) p.x = -p.size * 0.5;
        if (p.x < -p.size) p.x = w + p.size * 0.3;
        if (p.y > h + p.size * 0.5) p.y = -p.size * 0.5;
        if (p.y < -p.size) p.y = h + p.size * 0.3;
        const pulse = 0.7 + 0.3 * Math.sin(timestamp / 1000 * p.wobble + p.phase);
        this._drawParticle(ctx, p, p.opacity * pulse);
        continue;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Streaks move as a rigid shape via p.x += p.vx * dt above

      if (p.type === 'flake') {
        p.x += Math.sin(timestamp / 1000 * 2 + p.phase) * p.wobble * dt;
      }

      if (p.type === 'cloud' && p.x > w + 150) {
        this._resetParticle(p, false);
        continue;
      }

      if (p.y > h + 10 || p.x > w + 60 || (p.type !== 'streak' && p.x < -60) || (p.type === 'streak' && p.x > w + 30)) {
        this._resetParticle(p, false);
        continue;
      }

      let alpha = p.opacity;
      if (p.y < 20) alpha *= Math.max(0, (p.y + 10) / 30);
      if (p.y > h - 20) alpha *= Math.max(0, (h - p.y + 10) / 30);

      this._drawParticle(ctx, p, Math.max(0, alpha));
    }

    if (this._hasThunderstorm || this._conditionKey === 'thunderstorm' || this._overlayConditionKey === 'thunderstorm') {
      this._updateLightningFlash(ctx, w, h, timestamp);
    }

    this._rafId = requestAnimationFrame((t) => this._animationTick(t));
  }

  _drawParticle(ctx, p, alpha) {
    if (alpha <= 0.01) return;
    const c = this._colors || this._getAnimColors();
    ctx.save();
    ctx.globalAlpha = Math.min(alpha, 0.7);

    if (p.type === 'drop') {
      ctx.fillStyle = c.drop;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.size * 0.3, p.size * 2, Math.atan2(p.vy, p.vx || 0.01) - Math.PI / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.type === 'flake') {
      ctx.fillStyle = c.flake;
      ctx.shadowColor = c.flakeShadow;
      ctx.shadowBlur = p.size;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.type === 'hail') {
      ctx.fillStyle = c.hail;
      ctx.strokeStyle = c.hailStroke;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (p.type === 'streak') {
      const pts = p.shape;
      if (!pts || pts.length < 2) { ctx.restore(); return; }
      const [sr,sg,sb] = c.streak;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = p.size;
      const len = pts.length;
      for (let i = 1; i < len; i++) {
        const frac = i / len;
        const edgeFade = Math.min(frac * 5, (1 - frac) * 5, 1);
        const segAlpha = alpha * edgeFade;
        if (segAlpha < 0.005) continue;
        ctx.strokeStyle = `rgba(${sr},${sg},${sb},${segAlpha})`;
        ctx.beginPath();
        ctx.moveTo(p.x + pts[i - 1].x, p.y + pts[i - 1].y);
        ctx.lineTo(p.x + pts[i].x, p.y + pts[i].y);
        ctx.stroke();
      }
    } else if (p.type === 'cloud') {
      const [cr,cg,cb] = c.cloud;
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`;
      const b = p.size;
      // Fluffy bubble cloud: 4 overlapping circles
      ctx.beginPath();
      ctx.moveTo(p.x + b, p.y);
      ctx.arc(p.x, p.y, b, 0, Math.PI * 2);                         // center
      ctx.moveTo(p.x - b * 0.6 + b * 0.8, p.y + b * 0.2);
      ctx.arc(p.x - b * 0.6, p.y + b * 0.2, b * 0.8, 0, Math.PI * 2); // bottom-left
      ctx.moveTo(p.x + b * 0.6 + b * 0.8, p.y + b * 0.2);
      ctx.arc(p.x + b * 0.6, p.y + b * 0.2, b * 0.8, 0, Math.PI * 2); // bottom-right
      ctx.moveTo(p.x + b * 0.7, p.y - b * 0.5);
      ctx.arc(p.x, p.y - b * 0.5, b * 0.7, 0, Math.PI * 2);        // top
      ctx.fill();
      // Soft edge outline
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha * 0.15})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (p.type === 'fogcloud') {
      const [fr,fg,fb] = c.fogcloud;
      ctx.fillStyle = `rgba(${fr},${fg},${fb},${alpha})`;
      ctx.shadowColor = `rgba(${fr},${fg},${fb},${alpha * 0.3})`;
      ctx.shadowBlur = p.size * 0.3;
      const s = p.size;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, s * 0.5, s * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(p.x - s * 0.3, p.y + s * 0.08, s * 0.4, s * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(p.x + s * 0.35, p.y - s * 0.05, s * 0.38, s * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  _updateLightningFlash(ctx, w, h, timestamp) {
    const t = this._intensityFactor || 0;
    if (!this._lightningBolts) this._lightningBolts = [];
    if (!this._nextStrikeTime) this._nextStrikeTime = 0;
    // Shorter intervals, intensity-scaled: 0.5–2.1s base + 0.6–2.6s random
    const minInterval = 500 + (1 - t) * 1600;
    const maxExtra = 600 + (1 - t) * 2000;
    if (timestamp > this._nextStrikeTime) {
      // 40–70% chance of double bolt per strike
      const boltCount = Math.random() < 0.4 + t * 0.3 ? 2 : 1;
      for (let b = 0; b < boltCount; b++) {
        this._lightningBolts.push({
          bolt: this._generateLightningBolt(w, h),
          opacity: 0.25 + t * 0.15 + Math.random() * 0.15,
          delay: b * (30 + Math.random() * 70)
        });
      }
      this._nextStrikeTime = timestamp + minInterval + Math.random() * maxExtra;
    }
    // Draw all active bolts
    let maxOpacity = 0;
    for (const entry of this._lightningBolts) {
      if (entry.delay > 0) { entry.delay -= 16; continue; }
      if (entry.opacity > maxOpacity) maxOpacity = entry.opacity;
    }
    if (maxOpacity > 0.005) {
      const c = this._colors || this._getAnimColors();
      const [fr,fg,fb] = c.flashOverlay;
      ctx.save();
      ctx.fillStyle = `rgba(${fr},${fg},${fb},${maxOpacity * 0.4})`;
      ctx.fillRect(0, 0, w, h);
      for (const entry of this._lightningBolts) {
        if (entry.delay > 0 || entry.opacity <= 0.005) continue;
        this._drawLightningBolt(ctx, entry.opacity, entry.bolt);
        entry.opacity *= 0.88;
      }
      ctx.restore();
    }
    this._lightningBolts = this._lightningBolts.filter(e => e.opacity > 0.005 || e.delay > 0);
  }

  _generateLightningBolt(w, h) {
    const bolt = [];
    let x = w * (0.2 + Math.random() * 0.6);
    let y = 0;
    const targetY = h * (0.4 + Math.random() * 0.4);
    const segments = 8 + Math.floor(Math.random() * 6);
    const stepY = targetY / segments;
    bolt.push({ x, y });
    for (let i = 0; i < segments; i++) {
      x += (Math.random() - 0.5) * 30;
      y += stepY * (0.6 + Math.random() * 0.8);
      bolt.push({ x, y });
    }
    // Branch
    const branchIdx = Math.floor(segments * 0.3) + Math.floor(Math.random() * 3);
    let branch = null;
    if (branchIdx < bolt.length) {
      branch = [];
      let bx = bolt[branchIdx].x;
      let by = bolt[branchIdx].y;
      const bDir = Math.random() > 0.5 ? 1 : -1;
      for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
        bx += bDir * (5 + Math.random() * 15);
        by += stepY * (0.4 + Math.random() * 0.6);
        branch.push({ x: bx, y: by });
      }
    }
    return { main: bolt, branch, branchIdx };
  }

  _drawLightningBolt(ctx, opacity, bolt) {
    if (!bolt) bolt = this._lightningBolt;
    if (!bolt || !bolt.main.length) return;
    const c = this._colors || this._getAnimColors();
    const [gr,gg,gb] = c.lightningGlow;
    const [cr,cg,cb] = c.lightningCore;
    // Glow
    ctx.strokeStyle = `rgba(${gr},${gg},${gb},${opacity * 0.6})`;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(bolt.main[0].x, bolt.main[0].y);
    for (let i = 1; i < bolt.main.length; i++) ctx.lineTo(bolt.main[i].x, bolt.main[i].y);
    ctx.stroke();
    // Core
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${opacity})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bolt.main[0].x, bolt.main[0].y);
    for (let i = 1; i < bolt.main.length; i++) ctx.lineTo(bolt.main[i].x, bolt.main[i].y);
    ctx.stroke();
    // Branch
    if (bolt.branch && bolt.branchIdx < bolt.main.length) {
      const start = bolt.main[bolt.branchIdx];
      ctx.strokeStyle = `rgba(${gr},${gg},${gb},${opacity * 0.4})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (const pt of bolt.branch) ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${opacity * 0.7})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (const pt of bolt.branch) ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
    }
  }

  _updateCard(hass) {
    this._stopAnimation();
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

    let overallIconKey;
    let combinedSummary;
    if (config.preview_condition) {
      overallIconKey = config.preview_condition;
      combinedSummary = `Preview: ${config.preview_condition}`;
    } else {
      overallIconKey = this._getCurrentOverallIconKey(minutelyData, hourlyData);
      try {
        combinedSummary = this._getCombinedWeatherSummary(minutelyData, hourlyData);
      } catch (e) {
        console.error('Precipitation Radial: error generating summary', e);
        combinedSummary = hourlyData?.[0]?.summary || 'Weather data unavailable';
      }
    }
    const weatherIconClass = this._iconMap[overallIconKey] || this._iconMap['cloudy'];
    const compoundIcons = {
      'wi-partly-cloudy-day': '<div class="wi-sun-bg"></div>',
      'wi-partly-cloudy-night': '<div class="wi-moon-bg"></div>',
      'wi-windy': '<svg class="wi-wind-svg" viewBox="0 0 100 80" xmlns="http://www.w3.org/2000/svg"><path class="wi-wind-track wi-wt1" d="M -12 20 L 25 20 C 30 20, 30 10, 27 10 C 25 10, 25 20, 30 20 L 112 20"/><path class="wi-wind-track wi-wt2" d="M -12 42 L 44 42 C 49 42, 49 52, 46 52 C 44 52, 44 42, 49 42 L 112 42"/><path class="wi-wind-track wi-wt3" d="M -12 64 L 19 64 C 24 64, 24 54, 21 54 C 19 54, 19 64, 24 64 L 112 64"/></svg>',
    };
    const iconInner = compoundIcons[weatherIconClass] || '';

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
        overflow: hidden;
        border-radius: inherit;
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
        z-index: 2;
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
        color: var(--primary-text-color);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-shadow: 0 0 10px var(--card-background-color, #fff), 0 0 20px var(--card-background-color, #fff);
      }
      .summary-icon {
        position: relative;
        width: clamp(1.4em, 7cqi, 2.4em);
        height: clamp(1.4em, 7cqi, 2.4em);
        margin-bottom: 0.1em;
        flex-shrink: 0;
      }
      .summary-icon::before,
      .summary-icon::after {
        content: '';
        position: absolute;
        display: block;
      }

      /* --- Sun (clear-day) --- */
      .wi-sunny::before {
        width: 55%; height: 55%;
        top: 22%; left: 22%;
        background: #ffb830;
        border-radius: 50%;
        box-shadow: 0 0 6px 3px rgba(255,184,48,0.5), 0 0 14px 6px rgba(255,184,48,0.25);
        animation: wi-sun-pulse 3s ease-in-out infinite;
      }

      /* --- Moon (clear-night) --- */
      .wi-moon::before {
        width: 50%; height: 50%;
        top: 20%; left: 28%;
        background: #e0dcc8;
        border-radius: 50%;
        box-shadow: 0 0 4px 1px rgba(224,220,200,0.3);
      }
      .wi-moon::after {
        width: 40%; height: 40%;
        top: 12%; left: 42%;
        background: var(--card-background-color, #1c1c1e);
        border-radius: 50%;
      }

      /* --- Cloud base (shared shape) --- */
      .wi-cloudy::before,
      .wi-rainy::before,
      .wi-snowy::before,
      .wi-sleet::before,
      .wi-hail::before,
      .wi-thundery::before,
      .wi-partly-cloudy-day::before,
      .wi-partly-cloudy-night::before {
        width: 60%; height: 28%;
        bottom: 38%; left: 20%;
        border-radius: 10px;
        box-shadow:
          -0.3em -0.18em 0 -0.02em currentColor,
          0.18em -0.25em 0 0.03em currentColor;
      }

      /* Light cloud colors */
      .wi-cloudy::before { color: #b0b8c4; background: #b0b8c4; }
      .wi-partly-cloudy-day::before,
      .wi-partly-cloudy-night::before { color: #b0b8c4; background: #b0b8c4; z-index: 2; }

      /* Dark cloud colors (precipitation) */
      .wi-rainy::before,
      .wi-snowy::before,
      .wi-sleet::before { color: #8a95a6; background: #8a95a6; }
      .wi-hail::before { color: #7a8696; background: #7a8696; }
      .wi-thundery::before { color: #5a6270; background: #5a6270; }

      /* --- Partly-cloudy compound backgrounds --- */
      .wi-sun-bg {
        position: absolute;
        width: 36%; height: 36%;
        top: 12%; left: 14%;
        background: #ffb830;
        border-radius: 50%;
        box-shadow: 0 0 5px 2px rgba(255,184,48,0.4);
        animation: wi-sun-pulse 3s ease-in-out infinite;
        z-index: 1;
      }
      .wi-moon-bg {
        position: absolute;
        width: 32%; height: 32%;
        top: 10%; left: 16%;
        background: #e0dcc8;
        border-radius: 50%;
        box-shadow: 0 0 3px 1px rgba(224,220,200,0.25);
        z-index: 1;
        overflow: hidden;
      }
      .wi-moon-bg::after {
        content: '';
        position: absolute;
        width: 80%; height: 80%;
        top: -15%; right: -25%;
        background: var(--card-background-color, #1c1c1e);
        border-radius: 50%;
      }

      /* Partly-cloudy cloud bob */
      .wi-partly-cloudy-day::before,
      .wi-partly-cloudy-night::before {
        animation: wi-cloud-bob 4s ease-in-out infinite;
      }

      /* --- Rain --- */
      .wi-rainy::after {
        bottom: 14%; left: 26%;
        width: 2px; height: 18%;
        background: rgba(130,175,220,0.8);
        border-radius: 0 0 2px 2px;
        box-shadow:
          0.35em 0.04em 0 0 rgba(130,175,220,0.7),
          0.7em -0.02em 0 0 rgba(130,175,220,0.6),
          0.15em 0.08em 0 0 rgba(130,175,220,0.5);
        animation: wi-rain-fall 0.9s linear infinite;
      }

      /* --- Snow --- */
      .wi-snowy::after {
        bottom: 18%; left: 30%;
        width: 4px; height: 4px;
        background: #dce4f0;
        border-radius: 50%;
        box-shadow:
          0.3em 0.12em 0 0 #dce4f0,
          0.6em -0.04em 0 -0.5px #dce4f0,
          0.1em 0.24em 0 -0.5px rgba(220,228,240,0.7),
          0.45em 0.2em 0 0 rgba(220,228,240,0.8);
        animation: wi-snow-drift 2.2s ease-in-out infinite;
      }

      /* --- Sleet (mixed rain + snow) --- */
      .wi-sleet::after {
        bottom: 14%; left: 26%;
        width: 2px; height: 14%;
        background: rgba(130,175,220,0.7);
        border-radius: 0 0 2px 2px;
        box-shadow:
          0.35em 0.06em 0 0 rgba(130,175,220,0.6),
          0.65em -0.02em 0 0 rgba(130,175,220,0.5),
          0.18em 0.04em 0 1px #dce4f0,
          0.5em 0.1em 0 1px rgba(220,228,240,0.8);
        animation: wi-sleet-fall 1.1s linear infinite;
      }

      /* --- Hail --- */
      .wi-hail::after {
        bottom: 16%; left: 28%;
        width: 5px; height: 5px;
        background: rgba(200,215,235,0.9);
        border: 1px solid rgba(255,255,255,0.4);
        border-radius: 50%;
        box-shadow:
          0.3em 0.05em 0 0 rgba(200,215,235,0.85),
          0.55em 0.12em 0 -0.5px rgba(200,215,235,0.75),
          0.15em 0.18em 0 -0.5px rgba(200,215,235,0.65);
        animation: wi-hail-bounce 0.8s ease-in-out infinite;
      }

      /* --- Wind (SVG snake lines) --- */
      .wi-windy::before, .wi-windy::after { content: none; }
      .wi-wind-svg {
        position: absolute;
        top: 0; left: 0;
        width: 100%; height: 100%;
        overflow: visible;
      }
      .wi-wind-track {
        fill: none;
        stroke: rgba(180,195,220,0.7);
        stroke-width: 2.5;
        stroke-linecap: round;
        animation: wi-wind-snake linear infinite;
      }
      .wi-wt1 { stroke-dasharray: 22 120; stroke-dashoffset: 142; animation-duration: 2.5s; }
      .wi-wt2 { stroke-dasharray: 30 115; stroke-dashoffset: 145; animation-duration: 3.4s; animation-delay: 0.8s; }
      .wi-wt3 { stroke-dasharray: 24 118; stroke-dashoffset: 142; animation-duration: 2.9s; animation-delay: 1.8s; }

      /* --- Fog --- */
      .wi-fog::before {
        top: 25%; left: 12%;
        width: 65%; height: 3px;
        background: rgba(180,195,220,0.6);
        border-radius: 2px;
        box-shadow:
          0em 0.4em 0 0 rgba(180,195,220,0.45),
          0.1em 0.8em 0 0 rgba(180,195,220,0.3);
        animation: wi-fog-drift 4s ease-in-out infinite;
      }
      .wi-fog::after {
        top: 38%; left: 22%;
        width: 50%; height: 3px;
        background: rgba(180,195,220,0.4);
        border-radius: 2px;
        box-shadow: -0.1em 0.4em 0 0 rgba(180,195,220,0.25);
        animation: wi-fog-drift 4s ease-in-out 1.5s infinite;
      }

      /* --- Thunderstorm --- */
      .wi-thundery::after {
        top: 50%; left: 42%;
        width: 0; height: 0;
        background: none;
        border-left: 4px solid transparent;
        border-right: 4px solid transparent;
        border-top: 12px solid #ffe066;
        filter: drop-shadow(0 0 3px rgba(255,224,102,0.6));
        animation: wi-flash 2.5s step-end infinite;
      }

      /* --- Icon Keyframes --- */
      @keyframes wi-sun-pulse {
        0%, 100% { transform: scale(1); box-shadow: 0 0 6px 3px rgba(255,184,48,0.5), 0 0 14px 6px rgba(255,184,48,0.25); }
        50% { transform: scale(1.1); box-shadow: 0 0 10px 5px rgba(255,184,48,0.6), 0 0 20px 8px rgba(255,184,48,0.3); }
      }
      @keyframes wi-cloud-bob {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-6%); }
      }
      @keyframes wi-rain-fall {
        0% { transform: translateY(0); opacity: 1; }
        80% { opacity: 0.7; }
        100% { transform: translateY(0.4em); opacity: 0; }
      }
      @keyframes wi-snow-drift {
        0% { transform: translate(0, 0); opacity: 1; }
        50% { transform: translate(0.08em, 0.2em); opacity: 0.9; }
        100% { transform: translate(-0.04em, 0.4em); opacity: 0; }
      }
      @keyframes wi-sleet-fall {
        0% { transform: translateY(0); opacity: 1; }
        100% { transform: translateY(0.35em); opacity: 0; }
      }
      @keyframes wi-hail-bounce {
        0%, 100% { transform: translateY(0); }
        40% { transform: translateY(0.3em); }
        55% { transform: translateY(0.1em); }
        70% { transform: translateY(0.25em); }
        85% { transform: translateY(0.18em); }
      }
      @keyframes wi-wind-snake {
        to { stroke-dashoffset: 0; }
      }
      @keyframes wi-fog-drift {
        0%, 100% { transform: translateX(0); }
        50% { transform: translateX(8%); }
      }
      @keyframes wi-flash {
        0%, 40%, 42%, 60%, 62%, 100% { opacity: 0; }
        41%, 61% { opacity: 1; }
      }
      .summary-text {
        font-size: clamp(0.7em, 4cqi, 1.1em);
        font-weight: bold;
        line-height: 1.2;
        margin-bottom: 0.2em;
        color: var(--primary-text-color);
      }
      .detail-text {
        font-size: clamp(0.55em, 3cqi, 0.85em);
        line-height: 1.25;
        margin-top: 0.3em;
        color: var(--secondary-text-color);
      }
      .hour-label,
      .minute-label {
        fill: var(--primary-text-color);
        text-anchor: middle;
        dominant-baseline: middle;
        paint-order: stroke;
        stroke: var(--card-background-color, #fff);
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
        color: var(--secondary-text-color);
        line-height: 1.2;
        z-index: 3;
        display: flex;
        align-items: center;
        gap: 2px;
      }
      .locate-icon {
        cursor: pointer;
        --mdc-icon-size: clamp(12px, 4cqi, 18px);
        opacity: 0.7;
        transition: opacity 0.2s, transform 0.3s;
        color: var(--secondary-text-color);
      }
      .locate-icon:hover {
        opacity: 1;
      }
      .locate-icon.locating {
        opacity: 1;
        animation: spin-locate 1s linear infinite;
      }
      @keyframes spin-locate {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .minute-tick {
        stroke: var(--primary-text-color);
        stroke-width: 0.7px;
        stroke-linecap: round;
      }
      .wind-field {
        position: absolute; top: 0; left: 0;
        width: 100%; height: 100%;
        z-index: 1; pointer-events: none;
        border-radius: inherit; overflow: hidden;
      }
      .wind-field svg {
        width: 100%; height: 100%; display: block;
      }
      .wind-line {
        fill: none;
        stroke-width: 3;
        stroke-linecap: round;
        animation-name: wind-snake-anim;
        animation-timing-function: linear;
        animation-iteration-count: infinite;
      }
      @keyframes wind-snake-anim {
        to { stroke-dashoffset: 0; }
      }
    `;
    haCard.appendChild(style);

    const cardContainer = document.createElement('div');
    cardContainer.className = 'card-container';

    const locLabel = document.createElement('div');
    locLabel.className = 'location-label';
    const locIcon = document.createElement('ha-icon');
    locIcon.setAttribute('icon', 'mdi:crosshairs-gps');
    locIcon.className = 'locate-icon';
    locIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      this._handleLocateMe(locIcon);
    });
    locLabel.appendChild(locIcon);
    if (locationName) {
      const locText = document.createElement('span');
      locText.textContent = locationName;
      locLabel.appendChild(locText);
    }
    cardContainer.appendChild(locLabel);

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
      <div class="summary-icon ${weatherIconClass}">${iconInner}</div>
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

    // Dark/light mode detection
    this._darkMode = this._hass?.themes?.darkMode ??
      window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
    this._colors = this._getAnimColors();

    const precipTypes = ['rain', 'snow', 'sleet', 'hail', 'thunderstorm'];
    const previewCond = config.preview_condition || null;
    let sky, precip, intensityFactor;
    if (previewCond) {
      if (precipTypes.includes(previewCond)) {
        sky = 'cloudy';
        precip = previewCond;
      } else {
        sky = previewCond;
        precip = null;
      }
      intensityFactor = 0.5;
    } else {
      ({ sky, precip } = this._getCurrentConditions(minutelyData, hourlyData));
      const maxIntensity = minutelyData.slice(0, 15).reduce((mx, d) =>
        Math.max(mx, parseFloat(d.precipIntensity) || 0), 0);
      intensityFactor = Math.min(1, Math.sqrt(Math.min(maxIntensity, 1)));
    }
    const windSpeedNum = parseFloat(windSpeedRaw) || 0;
    // Wind as independent overlay: 0-5 mph = none, 5-33 mph = scales 0→1, 33+ capped
    const windFactor = windSpeedNum <= 5 ? 0 : Math.min(1, (windSpeedNum - 5) / 28);

    const skyAnim = this._mapConditionForAnimation(sky);
    const precipAnim = precip ? this._mapConditionForAnimation(precip) : null;

    this._createGradientLayer(cardContainer, precipAnim || skyAnim);
    this._createStackedAnimation(cardContainer, {
      sky: skyAnim,
      precip: precipAnim,
      windSpeed: windSpeedNum,
      windFactor,
      intensityFactor,
    });
  }

  getCardSize() {
    return 6;
  }
}

if (!customElements.get('precipitation-radial-card')) {
  customElements.define('precipitation-radial-card', PrecipitationRadialCard);
}

// Register with HA card picker
window.customCards = window.customCards || [];
if (!window.customCards.find(c => c.type === 'precipitation-radial-card')) {
  window.customCards.push({
    type: 'precipitation-radial-card',
    name: 'Precipitation Radial Card',
    description: 'A clock-style radial precipitation forecast card using PirateWeather data.',
    preview: false,
  });
}
