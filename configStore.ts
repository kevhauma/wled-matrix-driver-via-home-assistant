import { Config } from './config.ts';
import { defaultPanelConfig, PanelConfig, parsePanelConfig } from './panelConfig.ts';

/**
 * The panel configuration on disk.
 *
 * Resolved against this module rather than the working directory so the path
 * does not depend on where the process was launched from. Note that Deno's
 * `--allow-read`/`--allow-write` grants *are* resolved against the working
 * directory at startup, which is why the tasks in `deno.json` are the supported
 * way to run this — a bare `deno run` from elsewhere loses them.
 */
const CONFIG_URL = new URL('./panel.config.json', import.meta.url);

/**
 * A fixed name, not a random one: the write grant has to name the temp file
 * explicitly, and a random suffix could not be allow-listed. Only one process
 * writes this, so a fixed name is safe.
 */
const TEMP_URL = new URL('./panel.config.json.tmp', import.meta.url);

export const configPath = (): string => CONFIG_URL.pathname;

const toJson = (panel: PanelConfig): string => {
    const body = JSON.stringify(panel, null, 4);
    return `${body}\n`;
};

/**
 * Written to a sibling file and renamed over the original, so a crash midway
 * cannot leave a half-written configuration that then fails to parse at boot.
 */
export const savePanelConfig = async (panel: PanelConfig): Promise<PanelConfig> => {
    const validated = parsePanelConfig(panel);
    const body = toJson(validated);
    await Deno.writeTextFile(TEMP_URL, body);
    await Deno.rename(TEMP_URL, CONFIG_URL);
    return validated;
};

export type LoadedPanelConfig = {
    panel: PanelConfig,
    /** True when the file was absent and has just been seeded from the defaults. */
    wasSeeded: boolean,
};

/**
 * Reads the file, or writes the defaults and returns those. The environment
 * seeds the first write only; after that this file is the source of truth for
 * everything it covers.
 */
export const loadPanelConfig = async (config: Config): Promise<LoadedPanelConfig> => {
    let body: string;
    try {
        body = await Deno.readTextFile(CONFIG_URL);
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
            throw error;
        }
        const seeded = defaultPanelConfig(config);
        const panel = await savePanelConfig(seeded);
        return { panel, wasSeeded: true };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${CONFIG_URL.pathname} is not valid JSON: ${detail}`);
    }

    const panel = parsePanelConfig(parsed);
    return { panel, wasSeeded: false };
};
