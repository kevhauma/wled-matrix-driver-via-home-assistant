import { fetchEntityStates } from '../homeAssistant/states.ts';
import { byEntityId, matchesFilters, toLibraryItem } from '../library.ts';

/**
 * Prints entity ids so they can be pasted into the editor. Filters are matched
 * as substrings against the id, the friendly name and the device class:
 *
 *     deno task entities                     everything
 *     deno task entities media_player        one domain
 *     deno task entities battery temperature several filters, matched as OR
 *
 * The fetch lives in `homeAssistant/states.ts` and the filtering in
 * `library.ts`, because the editor's `/api/library` endpoint wants exactly the
 * same two things. This prints everything that matched; the endpoint truncates,
 * because a dropdown is not readable at a few thousand rows.
 */

const baseUrl = Deno.env.get('HA_BASE_URL')?.trim();
const token = Deno.env.get('HA_TOKEN')?.trim();

if (!baseUrl || !token) {
    console.error('Set HA_BASE_URL and HA_TOKEN (see .env.example).');
    Deno.exit(1);
}

let states;
try {
    states = await fetchEntityStates(baseUrl, token);
} catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(detail);
    Deno.exit(1);
}

const filters = Deno.args.map(argument => argument.toLowerCase());
const all = states.map(toLibraryItem);
const selected = all.filter(entity => matchesFilters(entity, filters));
selected.sort(byEntityId);

for (const entity of selected) {
    const reading = `${entity.state}${entity.unit}`;
    const id = entity.entityId.padEnd(48);
    const value = reading.padEnd(16);
    const kind = entity.deviceClass.padEnd(14);
    console.log(`${id} ${value} ${kind} ${entity.friendlyName}`);
}

console.log(`\n${selected.length} of ${all.length} entities.`);
