import { describe, expect, it, vi } from 'vitest';
import { PermissionHandler } from './permissionHandler';
import { PLAN_FAKE_REJECT, PLAN_FAKE_RESTART } from '../sdk/prompts';
import type { Session } from '../session';

function createFakeSession() {
    const queueItems: { message: string; mode: unknown }[] = [];
    let permissionMode: string | undefined;

    const session = {
        client: {
            rpcHandlerManager: {
                registerHandler: vi.fn(),
            },
            updateAgentState: vi.fn(),
        },
        queue: {
            unshift: vi.fn((message: string, mode: unknown) => {
                queueItems.push({ message, mode });
            }),
        },
        setPermissionMode: vi.fn((mode: string) => {
            permissionMode = mode;
        }),
        getPermissionMode: vi.fn(() => permissionMode),
    } as unknown as Session;

    return { session, queueItems };
}

describe('PermissionHandler — YOLO plan mode', () => {
    it('sends exit_plan_mode through permission request flow in bypassPermissions', async () => {
        const { session } = createFakeSession();
        const handler = new PermissionHandler(session);
        handler.handleModeChange('bypassPermissions');

        // Simulate Claude emitting an assistant message with exit_plan_mode tool_use
        handler.onMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{ type: 'tool_use', id: 'tc-1', name: 'exit_plan_mode', input: {} }],
            },
        } as any);

        // handleToolCall should block (waiting for user review), not auto-approve
        const resultPromise = handler.handleToolCall(
            'exit_plan_mode',
            {},
            { permissionMode: 'bypassPermissions' } as any,
            { signal: new AbortController().signal }
        );

        // The call should not have resolved yet (it's waiting for permission)
        let resolved = false;
        resultPromise.then(() => { resolved = true; });
        await new Promise(r => setTimeout(r, 50));
        expect(resolved).toBe(false);

        // Verify updateAgentState was called to register the pending request
        expect(session.client.updateAgentState).toHaveBeenCalled();
    });

    it('sends ExitPlanMode through permission request flow in bypassPermissions', async () => {
        const { session } = createFakeSession();
        const handler = new PermissionHandler(session);
        handler.handleModeChange('bypassPermissions');

        handler.onMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{ type: 'tool_use', id: 'tc-2', name: 'ExitPlanMode', input: {} }],
            },
        } as any);

        const resultPromise = handler.handleToolCall(
            'ExitPlanMode',
            {},
            { permissionMode: 'bypassPermissions' } as any,
            { signal: new AbortController().signal }
        );

        let resolved = false;
        resultPromise.then(() => { resolved = true; });
        await new Promise(r => setTimeout(r, 50));
        expect(resolved).toBe(false);

        expect(session.client.updateAgentState).toHaveBeenCalled();
    });

    it('allows normal tools in bypassPermissions without queue injection', async () => {
        const { session, queueItems } = createFakeSession();
        const handler = new PermissionHandler(session);
        handler.handleModeChange('bypassPermissions');

        handler.onMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{ type: 'tool_use', id: 'tc-3', name: 'Bash', input: { command: 'ls' } }],
            },
        } as any);

        const result = await handler.handleToolCall(
            'Bash',
            { command: 'ls' },
            { permissionMode: 'bypassPermissions' } as any,
            { signal: new AbortController().signal }
        );

        expect(result.behavior).toBe('allow');
        expect(queueItems).toHaveLength(0);
    });

    // Regression: turn-in-progress switch from default to bypassPermissions via
    // SetSessionConfig RPC updates session.setPermissionMode but doesn't go
    // through handler.handleModeChange. The next canCallTool must reflect the
    // new mode. See issue #735.
    it('reflects session permission mode changes between tool calls', async () => {
        const { session } = createFakeSession();
        const handler = new PermissionHandler(session);
        handler.handleModeChange('default');

        // Simulate RPC handler in runClaude updating the session directly,
        // bypassing handler.handleModeChange (as happens on web dropdown change).
        session.setPermissionMode('bypassPermissions');

        handler.onMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{ type: 'tool_use', id: 'tc-4', name: 'Bash', input: { command: 'ls' } }],
            },
        } as any);

        const result = await handler.handleToolCall(
            'Bash',
            { command: 'ls' },
            { permissionMode: 'bypassPermissions' } as any,
            { signal: new AbortController().signal }
        );

        expect(result.behavior).toBe('allow');
    });
});
