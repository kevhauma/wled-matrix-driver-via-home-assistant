import { upgradePanelConfig } from '../configUpgrade.ts';
import { CONFIG_VERSION, parsePanelConfig } from '../panelConfig.ts';

const assertSame = (actual: unknown, expected: unknown, message: string): void => {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
    }
};

const VERSION_1 = {
    version: 1,
    output: { wledIp: '', brightness: 80 },
    entities: [
        {
            entityId: 'sensor.power',
            kind: 'text',
            display: { style: 'text', segmentId: 0, color: [255, 255, 255], speed: 70, prefix: 'PV ' },
        },
        {
            entityId: 'sensor.temperature',
            kind: 'temperature',
            display: { style: 'text', segmentId: 0, color: [255, 255, 255], speed: 70 },
        },
        {
            entityId: 'sensor.battery',
            kind: 'percent',
            display: { style: 'bar', segmentId: 0, color: [0, 255, 80], trackColor: [0, 20, 40] },
        },
    ],
    flow: [{ id: 'idle', match: 'all', conditions: [], action: { do: 'blank' } }],
};

Deno.test('a version 1 file is upgraded and then passes the current validator', () => {
    const { config, upgradedFrom } = upgradePanelConfig(VERSION_1);
    const parsed = parsePanelConfig(config);

    assertSame(upgradedFrom, 1, 'it says what it upgraded from');
    assertSame(parsed.version, CONFIG_VERSION, 'and is current');
});

Deno.test('a prefix becomes the text in front of {{value}}, and its absence {{value}} alone', () => {
    const { config } = upgradePanelConfig(VERSION_1);
    const parsed = parsePanelConfig(config);
    const [power, temperature, battery] = parsed.entities.map(entity => entity.display);

    assertSame(power.style === 'text' && power.text, 'PV {{value}}', 'the prefix moved in');
    assertSame('prefix' in power, false, 'and is gone');
    assertSame(temperature.style === 'text' && temperature.text, '{{value}}', 'no prefix, value alone');
    assertSame(battery.style, 'bar', 'a bar is untouched');
});

Deno.test('a current file is passed through and reported as not upgraded', () => {
    const { config: current } = upgradePanelConfig(VERSION_1);

    const again = upgradePanelConfig(current);

    assertSame(again.config, current, 'the same object');
    assertSame(again.upgradedFrom, undefined, 'nothing to report');
});

Deno.test('a version 3 file gets the host’s own timezone, which is what it had', () => {
    const version3 = { ...VERSION_1, version: 3, entities: [] };

    const { config, upgradedFrom } = upgradePanelConfig(version3);
    const parsed = parsePanelConfig(config);

    assertSame(upgradedFrom, 3, 'from version 3');
    assertSame(parsed.output.timeZone, '', 'empty is the host’s zone');
    assertSame(parsed.output.brightness, 80, 'and the rest of the output kept');
});

Deno.test('a loop’s entity ids become members, numbered only where one repeats', () => {
    const version2 = {
        ...VERSION_1,
        version: 2,
        entities: [],
        flow: [{
            id: 'sensors',
            match: 'all',
            conditions: [],
            action: { do: 'loop', entityIds: ['sensor.a', 'sensor.b', 'sensor.a'], dwellSeconds: 5 },
        }],
    };

    const { config, upgradedFrom } = upgradePanelConfig(version2);
    const flow = (config as { flow: { action: Record<string, unknown> }[] }).flow;
    const members = flow[0].action.members as { id: string, entityId: string }[];

    assertSame(upgradedFrom, 2, 'from version 2');
    assertSame(members.map(member => member.id).join(' '), 'sensor.a sensor.b sensor.a-2', 'unique ids');
    assertSame(members[2].entityId, 'sensor.a', 'the entity kept');
    assertSame('entityIds' in flow[0].action, false, 'and the old field gone');
});
