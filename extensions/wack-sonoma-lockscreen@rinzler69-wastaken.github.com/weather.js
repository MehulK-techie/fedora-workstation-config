// MK: the weather, for the lock screen's pill and the calendar's header.
// Open-Meteo (no key: api.open-meteo.com/v1/forecast?current_weather=true)
// for where you are, found from your connection's IP (ipapi.co, then ipwho.is, both
// over HTTPS; if both fail, the last place found, then Jaipur, 26.9124 N 75.7873 E).
// Every 30 minutes while on, and once as the session starts. The last reading
// is kept in the settings (weather-cache-text "24°C Clear Sky",
// weather-cache-icon, weather-cache-time), so it shows at once after a boot,
// before the network is up. weather-enabled off: no requests at all.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

const EVERY = 30 * 60;                       // seconds between readings
const FALLBACK = {lat: 26.9124, lon: 75.7873, city: 'Jaipur'};

// WMO weather codes (Open-Meteo's) -> words and a symbolic icon
export function describe(code) {
    if (code === 0)
        return ['Clear Sky', 'weather-clear-symbolic'];
    if (code <= 3)
        return [code === 3 ? 'Overcast' : 'Partly Cloudy', code === 3 ? 'weather-overcast-symbolic' : 'weather-few-clouds-symbolic'];
    if (code >= 45 && code <= 48)
        return ['Foggy', 'weather-fog-symbolic'];
    if (code >= 51 && code <= 67)
        return ['Rain', 'weather-showers-symbolic'];
    if (code >= 71 && code <= 77)
        return ['Snow', 'weather-snow-symbolic'];
    if (code >= 80 && code <= 82)
        return ['Rain Showers', 'weather-showers-scattered-symbolic'];
    if (code >= 85 && code <= 86)
        return ['Snow Showers', 'weather-snow-symbolic'];
    if (code >= 95)
        return ['Thunderstorm', 'weather-storm-symbolic'];
    return ['Cloudy', 'weather-overcast-symbolic'];
}

export class WeatherService {
    constructor(settings) {
        this._settings = settings;
        this._session = new Soup.Session({timeout: 12, user_agent: 'MK-Workstation-Weather/1.0'});
        this._cancel = new Gio.Cancellable();
        this._id = settings.connect('changed::weather-enabled', () => this._schedule(true));
        this._schedule(true);
    }

    _schedule(now) {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
        if (!this._settings.get_boolean('weather-enabled'))
            return;
        // the first reading a few seconds in (the network comes up with the session), then every 30 min
        const age = Date.now() / 1000 - this._settings.get_int64('weather-cache-time');
        const wait = now ? (age > EVERY ? 8 : Math.max(8, EVERY - age)) : EVERY;
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, Math.round(wait), () => {
            this._timer = 0;
            this.refresh().finally(() => this._schedule(false));
            return GLib.SOURCE_REMOVE;
        });
    }

    async _json(url) {
        const msg = Soup.Message.new('GET', url);
        const bytes = await new Promise((resolve, reject) => {
            this._session.send_and_read_async(msg, GLib.PRIORITY_LOW, this._cancel, (s, res) => {
                try {
                    resolve(s.send_and_read_finish(res));
                } catch (e) {
                    reject(e);
                }
            });
        });
        if (msg.get_status() !== Soup.Status.OK)
            throw new Error(`HTTP ${msg.get_status()}`);
        return JSON.parse(new TextDecoder().decode(bytes.get_data()));
    }

    async _place() {
        // two keyless HTTPS lookups (ipapi.co rate-limits often), then the last place, then Jaipur
        for (const url of ['https://ipapi.co/json/', 'https://ipwho.is/']) {
            try {
                const j = await this._json(url);
                if (Number.isFinite(j.latitude) && Number.isFinite(j.longitude)) {
                    const place = {lat: j.latitude, lon: j.longitude, city: j.city ?? ''};
                    this._settings.set_string('weather-cache-place', JSON.stringify(place));
                    return place;
                }
            } catch {}
        }
        try {
            return JSON.parse(this._settings.get_string('weather-cache-place')) ?? FALLBACK;
        } catch {
            return FALLBACK;
        }
    }

    // one reading now; the cache keys change (and everything showing them follows)
    async refresh() {
        try {
            const {lat, lon, city} = await this._place();
            const j = await this._json('https://api.open-meteo.com/v1/forecast?latitude=' +
                `${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current_weather=true`);
            const cw = j.current_weather;
            if (!cw || !Number.isFinite(cw.temperature))
                throw new Error('no current weather');
            const [words, icon] = describe(Number(cw.weathercode));
            const night = cw.is_day === 0 && icon === 'weather-clear-symbolic';
            this._settings.set_string('weather-cache-text', `${Math.round(cw.temperature)}°C ${words}`);
            this._settings.set_string('weather-cache-icon', night ? 'weather-clear-night-symbolic' : icon);
            this._settings.set_string('weather-cache-city', city ?? '');
            this._settings.set_int64('weather-cache-time', Math.floor(Date.now() / 1000));
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.log(`wack-sonoma-lockscreen: weather: ${e.message}`);     // (the last reading stays)
        }
    }

    destroy() {
        this._cancel.cancel();
        if (this._timer)
            GLib.source_remove(this._timer);
        this._settings.disconnect(this._id);
        this._session.abort();
    }
}
