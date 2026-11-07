/** WMO weather codes (Open-Meteo) → short label + icon. */
export function wx(code: number, isDay = true): { label: string; icon: string } {
  if (code === 0) return { label: isDay ? 'Clear' : 'Clear night', icon: isDay ? 'sun' : 'moon' };
  if (code <= 2) return { label: 'Partly cloudy', icon: isDay ? 'sun' : 'moon' };
  if (code === 3) return { label: 'Cloudy', icon: 'cloud' };
  if (code === 45 || code === 48) return { label: 'Fog', icon: 'cloud' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: 'drop' };
  if (code >= 61 && code <= 67) return { label: code >= 65 ? 'Heavy rain' : 'Rain', icon: 'drop' };
  if (code >= 71 && code <= 77) return { label: 'Snow', icon: 'cloud' };
  if (code >= 80 && code <= 82) return { label: 'Showers', icon: 'drop' };
  if (code >= 95) return { label: 'Thunderstorm', icon: 'bolt' };
  return { label: 'Cloudy', icon: 'cloud' };
}
export function aqiLabel(aqi: number | null) {
  if (aqi === null) return null;
  if (aqi <= 50) return { label: 'Good', tone: 'good' };
  if (aqi <= 100) return { label: 'Moderate', tone: 'ok' };
  if (aqi <= 150) return { label: 'Unhealthy for some', tone: 'warn' };
  if (aqi <= 200) return { label: 'Unhealthy', tone: 'bad' };
  return { label: 'Very unhealthy', tone: 'bad' };
}
