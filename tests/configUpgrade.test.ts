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

Deno.test('a version 4 case lists states, so it says so, wherever its display is', () => {
    const weather = {
        style: 'byState',
        cases: [{ states: ['sunny'], display: { style: 'text', segmentId: 0, color: [1, 2, 3], speed: 60, text: 'sun' } }],
        otherwise: { style: 'text', segmentId: 0, color: [1, 2, 3], speed: 60, text: '{{value}}' },
    };
    const version4 = {
        version: 4,
        output: { wledIp: '', brightness: 80, timeZone: '' },
        entities: [{ entityId: 'weather.home', kind: 'text', display: weather }],
        flow: [
            { id: 'show', match: 'all', conditions: [], action: { do: 'show', entityId: 'weather.home', display: weather } },
            {
                id: 'loop',
                match: 'all',
                conditions: [],
                action: { do: 'loop', members: [{ id: 'w', entityId: 'weather.home', display: weather }], dwellSeconds: 5 },
            },
        ],
    };

    const { config, upgradedFrom } = upgradePanelConfig(version4);
    const parsed = parsePanelConfig(config);
    const show = parsed.flow[0].action;
    const loop = parsed.flow[1].action;
    const testsOf = (display: unknown) =>
        (display as { cases: { test: string }[] }).cases.map(candidate => candidate.test).join(' ');

    assertSame(upgradedFrom, 4, 'from version 4');
    assertSame(testsOf(parsed.entities[0].display), 'is', 'the entity’s own');
    assertSame(show.do === 'show' && testsOf(show.display), 'is', 'a show rule’s');
    assertSame(loop.do === 'loop' && testsOf(loop.members[0].display), 'is', 'a loop member’s');
    assertSame('test' in weather.cases[0], false, 'and the file as read is not changed');
});

Deno.test('version 5 moves a text view’s settings into its own, keeping only what differs', () => {
    const version5 = {
        version: 5,
        output: { wledIp: '', brightness: 80, timeZone: '' },
        entities: [
            {
                // Exactly the old defaults, so it ends up following the global.
                entityId: 'sensor.plain',
                kind: 'text',
                display: { style: 'text', segmentId: 0, color: [255, 255, 255], speed: 70, text: '{{value}}' },
            },
            {
                entityId: 'sensor.loud',
                kind: 'text',
                display: { style: 'text', segmentId: 0, color: [255, 0, 0], speed: 10, text: '{{value}}' },
            },
            {
                entityId: 'sensor.solar',
                kind: 'text',
                display: {
                    style: 'iconText',
                    pixels: new Array(256).fill('000000'),
                    textStart: 8,
                    color: [255, 255, 255],
                    speed: 70,
                    text: '{{value}}',
                    font: 2,
                    yOffset: 161,
                },
            },
            {
                entityId: 'sensor.battery',
                kind: 'percent',
                display: { style: 'bar', segmentId: 0, color: [0, 255, 80], trackColor: [0, 20, 40] },
            },
        ],
        flow: [{ id: 'idle', match: 'all', conditions: [], action: { do: 'blank' } }],
    };

    const { config, upgradedFrom } = upgradePanelConfig(version5);
    const parsed = parsePanelConfig(config);
    const settingsOf = (index: number) => {
        const display = parsed.entities[index].display;
        const own = display.style === 'text' || display.style === 'iconText' ? display.settings : {};
        return JSON.stringify(own);
    };

    assertSame(upgradedFrom, 5, 'from version 5');
    assertSame(parsed.version, CONFIG_VERSION, 'to the current one');
    assertSame(parsed.textSettings.speed, 70, 'the global takes what a text display was seeded with');
    assertSame(parsed.textSettings.font, 0, 'and the font every plain text segment was pinned to');
    assertSame(parsed.textSettings.trail, 0, 'the trail it adds is no trail, as the icon style hardcoded');
    assertSame(parsed.textSettings.rotation, 'normal', 'and upright, which is c3 16 rather than 0');

    assertSame(settingsOf(0), '{}', 'a view that matched the old defaults now follows the global');
    assertSame(settingsOf(1), '{"color":[255,0,0],"speed":10}', 'one that differed keeps both');
    assertSame(settingsOf(2), '{"yOffset":161,"font":2}', 'an icon view keeps only its offset and font');

    const bar = parsed.entities[3].display;
    assertSame(bar.style === 'bar' && JSON.stringify(bar.color), '[0,255,80]', 'a bar keeps its own colour');
    assertSame('settings' in version5.entities[0].display, false, 'and the file as read is not changed');
});
