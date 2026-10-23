import { createBridge } from './bridge.ts';
import { loadConfig } from './config.ts';
import { configPath, loadPanelConfig } from './configStore.ts';
import { PanelConfig } from './panelConfig.ts';
import { startServer } from './server.ts';

/** The entry point: configuration in, one bridge, and a way to stop it. */

const LABEL_WIDTH = 14;

const formatTime = (): string => {
    const now = new Date();
    const text = now.toTimeString();
    return text.slice(0, 8);
};

const log = (label: string, detail: string): void => {
    const time = formatTime();
    const padded = label.padEnd(LABEL_WIDTH);
    console.log(`[${time}] ${padded} ${detail}`);
};

/**
 * A bad `.env` or a hand-edited `panel.config.json` is a user error, not a
 * crash: the validator's message already names the field and the value, so
 * print it alone rather than burying it in a stack trace.
 */
const startUpOrExit = async () => {
    try {
        const config = loadConfig();
        const loaded = await loadPanelConfig(config);
        return { config, ...loaded };
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`wled-ha-bridge: ${detail}`);
        Deno.exit(1);
    }
};

const { config, panel, wasSeeded, upgradedFrom } = await startUpOrExit();
const bridge = createBridge({ config, panel, onLog: log });

/** The server reads this, so a save is visible to the next `GET /api/config`. */
let current: PanelConfig = panel;

const server = startServer({
    bridge,
    config,
    panel: () => current,
    onSaved: saved => {
        current = saved;
    },
    onLog: log,
});

const where = config.homeAssistant.token ? config.homeAssistant.baseUrl : 'mock source';
const output = panel.output.wledIp ? `WLED ${panel.output.wledIp}` : 'dry run (set WLED_IP to post)';

console.log(`wled-ha-bridge: ${where} -> ${output}`);
console.log(`${panel.entities.length} entities, ${panel.flow.length} flow rules`);
console.log(`editor on http://127.0.0.1:${config.port}`);
if (wasSeeded) {
    const path = configPath();
    console.log(`wrote ${path} from the defaults`);
}
if (upgradedFrom !== undefined) {
    const path = configPath();
    console.log(`read ${path} as version ${upgradedFrom}; the next save writes version ${panel.version}`);
}
console.log('');

bridge.start();

const shutdown = async () => {
    console.log('');
    await server.shutdown();
    await bridge.stop();
    Deno.exit(0);
};

Deno.addSignalListener('SIGINT', shutdown);
Deno.addSignalListener('SIGTERM', shutdown);
