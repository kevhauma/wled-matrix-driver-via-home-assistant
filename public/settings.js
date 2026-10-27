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
    ]));
};
