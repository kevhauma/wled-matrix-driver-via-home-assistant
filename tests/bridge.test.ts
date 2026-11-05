import { createBridge } from '../bridge.ts';
import { Config } from '../config.ts';
import { displaysInFlow } from '../flow.ts';
import { defaultPanelConfig } from '../panelConfig.ts';

const config: Config = {
    homeAssistant: { baseUrl: '', token: '' },
    wled: { ip: '', brightness: 128 },
    rotateSeconds: 10,
    mockStepSeconds: 60,
    port: 0,
};

const assertSame = (actual: unknown, expected: unknown, message: string): void => {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    if (actualJson !== expectedJson) {
        throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
    }
};

const settle = () => new Promise(resolve => setTimeout(resolve, 10));

Deno.test('a preview pauses the flow on one view, and releasing it resumes the flow', async () => {
    const panel = defaultPanelConfig(config);
    const bridge = createBridge({ config, panel, onLog: () => {} });
    bridge.start();
    await settle();
    const flowPick = bridge.snapshot().decision;

    const pinned = panel.entities.find(entity =>
        flowPick?.show !== 'entity' || entity.entityId !== flowPick.entityId
    )!;
    bridge.preview({
        entityId: pinned.entityId,
        display: undefined,
        entities: panel.entities,
        flowDisplays: displaysInFlow(panel.flow),
        textSettings: panel.textSettings,
    });
    await settle();
    const during = bridge.snapshot();
    assertSame(during.previewing, true, 'previewing');
    assertSame(during.decision, { show: 'entity', entityId: pinned.entityId }, 'the pinned view');

    bridge.preview(undefined);
    await settle();
    const after = bridge.snapshot();
    assertSame(after.previewing, false, 'released');
    assertSame(after.decision, flowPick, 'the flow decides again');

    await bridge.stop();
});
