/**
 * The one-shot REST list of every entity Home Assistant knows about.
 *
 * This is the one case a subscription buys nothing: the entity picker and
 * `deno task entities` both want a list once. Keeping it on REST also keeps the
 * picker from widening the live `subscribe_entities` subscription, which only
 * ever carries the handful of entities the panel actually uses.
 *
 * What the picker is *shown* — which rows, in what order, how many — is
 * `library.ts`'s business, not this module's.
 */

export type RestEntityState = {
    entity_id: string,
    state: string,
    attributes: Record<string, unknown>,
};

export const fetchEntityStates = async (
    baseUrl: string,
    token: string,
): Promise<RestEntityState[]> => {
    const trimmed = baseUrl.replace(/\/+$/, '');
    const response = await fetch(`${trimmed}/api/states`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (!response.ok) {
        await response.body?.cancel();
        const hint = response.status === 401
            ? ' (check HA_TOKEN is a long-lived access token)'
            : '';
        throw new Error(`Home Assistant /api/states returned ${response.status}${hint}.`);
    }

    const states = await response.json() as RestEntityState[];
    return states;
};
