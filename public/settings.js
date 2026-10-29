import { requestJson } from '/api.js';
import { card, field, make, option, sliderField } from '/dom.js';

/**
 * What belongs to the device rather than to any one entity: where it is, how
 * bright, and what clock it keeps. It used to sit under the Display tab's
 * editor, which made it look like part of whichever entity was open.
 */

/**
 * What the built-in clock and a flow's time window read in. The list is the
 * browser's, which is the same ICU list the server checks against in all but
 * the newest zones — and a saved zone missing from it is added rather than
 * silently shown as something else.
 */
const timeZoneSelect = context => {
    const { output } = context.config;
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // The browser's list leaves out UTC, which is a zone the server accepts.
    const zones = ['UTC', ...Intl.supportedValuesOf('timeZone').filter(zone => zone !== 'UTC')];
    const listed = zones.includes(output.timeZone) || output.timeZone === ''
        ? zones
        : [output.timeZone, ...zones];

    const choices = [
        option('', 'the host’s own', output.timeZone === ''),
        ...listed.map(zone => {
            const text = zone === here ? `${zone} — this browser` : zone;
            return option(zone, text, zone === output.timeZone);
        }),
    ];

    return make('select', {
        onChange: event => {
            output.timeZone = event.target.value;
            context.changed();
        },
    }, choices);
};

/** Said, not explained: an empty address is a state worth seeing at a glance. */
const describeAddress = wledIp => wledIp === ''
    ? 'Dry run — nothing is sent to a device.'
    : `Posting to http://${wledIp}/json/state`;

/**
 * Fetched again rather than taken from the draft, so the file is what the
 * service is running — unsaved edits are not in it. Written the way
 * `configStore.ts` writes it, so it can be dropped in as `panel.config.json`.
 */
const exportConfig = async context => {
    try {
        const saved = await requestJson('/api/config');
        const text = `${JSON.stringify(saved, null, 4)}\n`;
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = make('a', { href: url, download: 'panel.config.json' });
        link.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        context.setStatus(error.message, 'error');
    }
};

export const renderSettings = (root, context) => {
    const { config } = context;
    root.className = 'narrow';

    const brightness = sliderField('Brightness', config.output.brightness, value => {
        config.output.brightness = value;
        context.edited();
    });

    const where = make('p', { class: 'hint', textContent: describeAddress(config.output.wledIp) });

    const ip = make('input', {
        type: 'text',
        value: config.output.wledIp,
        placeholder: 'e.g. 192.168.1.69',
        spellcheck: false,
        onInput: event => {
            where.textContent = describeAddress(event.target.value.trim());
        },
        onChange: event => {
            config.output.wledIp = event.target.value.trim();
            context.changed();
        },
    });

    root.append(card('Device', [
        make('div', { class: 'fields' }, [
            make('div', { class: 'field-stack' }, [field('WLED address', ip), where]),
            brightness,
        ]),
    ], [
        'The WLED device the panel is. Leave the address empty to print each '
            + '/json/state body in the service’s log instead of posting it — handy for '
            + 'trying a flow without the hardware.',
        'Brightness applies to everything the panel shows, custom displays included, '
            + 'unless a custom body sets its own "bri".',
        'WLED_IP and WLED_BRIGHTNESS in .env only seeded these the first time the '
            + 'configuration was written. What is here wins now.',
    ]), card('Clock', [
        make('div', { class: 'fields' }, [field('Timezone', timeZoneSelect(context))]),
    ], [
        'What the built-in time and date items show, and what a flow’s time window is '
            + 'checked against. Both are read on this machine, not on the WLED device.',
        '“The host’s own” uses the timezone of the machine running the service, which on '
            + 'a container or a fresh Raspberry Pi is usually UTC — pick one to be sure.',
    ]), card('Configuration', [
        make('div', { class: 'row' }, [
            make('button', {
                type: 'button',
                textContent: 'Export',
                title: 'Download the saved configuration as panel.config.json',
                onClick: () => void exportConfig(context),
            }),
        ]),
    ], [
        'Downloads the configuration as saved — unsaved changes are not in it — as '
            + 'panel.config.json.',
        'To run it elsewhere, put the file next to main.ts, replacing the one there, '
            + 'and restart the service. It carries the WLED address too, so a copy left '
            + 'running posts to the same device as this one.',
    ]));
};
