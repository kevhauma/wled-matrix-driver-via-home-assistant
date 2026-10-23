/**
 * Both of the service's halves are optional, which is what makes the PoC
 * runnable with nothing set up: no `HA_TOKEN` uses the mock source, and no
 * `WLED_IP` prints the payload instead of posting it.
 *
 * `WLED_IP` and `WLED_BRIGHTNESS` are read here only to seed
 * `panel.config.json` the first time it is written; after that the file wins,
 * because they are editable in the UI. See `panelConfig.ts`.
 */

export type Config = {
    homeAssistant: {
        baseUrl: string,
        /** Empty means run against the mock source. */
        token: string,
    },
    wled: {
        /** Empty means print the payload rather than posting it. */
        ip: string,
        brightness: number,
    },
    /** How long each rotating entity holds the panel. */
    rotateSeconds: number,
    /** Mock source only: how long each step of its script holds. */
    mockStepSeconds: number,
    /** Where the editor is served. Loopback only. */
    port: number,
};

const readString = (name: string, fallback: string): string =>
    Deno.env.get(name)?.trim() ?? fallback;

/**
 * A bare `host:port` is what people actually paste, and it is not a URL: the
 * REST calls build `${baseUrl}/api/...` and would produce something `fetch`
 * rejects outright. Assume plain HTTP, which is what a LAN address is.
 */
const normalizeBaseUrl = (value: string): string => {
    const trimmed = value.replace(/\/+$/, '');
    if (!trimmed) {
        return '';
    }
    const hasScheme = /^https?:\/\//.test(trimmed);
    return hasScheme ? trimmed : `http://${trimmed}`;
};

const readNumber = (name: string, fallback: number): number => {
    const raw = Deno.env.get(name)?.trim();
    if (!raw) {
        return fallback;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
        throw new Error(`${name} must be a number, got '${raw}'.`);
    }
    return value;
};

export const loadConfig = (): Config => {
    const baseUrl = readString('HA_BASE_URL', '');
    const token = readString('HA_TOKEN', '');

    if (token && !baseUrl) {
        throw new Error('HA_TOKEN is set but HA_BASE_URL is not; set both, or neither to use the mock.');
    }

    return {
        homeAssistant: { baseUrl: normalizeBaseUrl(baseUrl), token },
        wled: {
            ip: readString('WLED_IP', ''),
            brightness: readNumber('WLED_BRIGHTNESS', 96),
        },
        rotateSeconds: readNumber('ROTATE_SECONDS', 5),
        mockStepSeconds: readNumber('MOCK_STEP_SECONDS', 8),
        port: readNumber('PORT', 8000),
    };
};
