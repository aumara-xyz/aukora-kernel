import { execFileSync } from 'child_process';
import { Proposer, ProposerContext, scrubOutboundPrompt } from './proposer';
import { RawIntent } from './normalizer';

export class LocalModelProposer implements Proposer {
  constructor(private command: string, private args: string[] = []) {}

  propose(context: ProposerContext): RawIntent {
    // 1. Structure the outbound payload (no free-form env dumps)
    const payload = JSON.stringify({
      task: context.prompt,
      history: context.history,
      schema: { action: "string", resource: "string", ring: "string" }
    });

    // 2. Scrub the payload of any secrets
    const scrubbedPayload = scrubOutboundPrompt(payload);

    // 3. Execute the local model process
    // We pass the scrubbed payload as a base64 encoded argument to avoid shell escaping issues
    const encodedPayload = Buffer.from(scrubbedPayload).toString('base64');
    
    let stdout: string;
    try {
      stdout = execFileSync(this.command, [...this.args, encodedPayload], { 
        encoding: 'utf-8', 
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
        maxBuffer: 1024 * 1024
      });
    } catch (err: any) {
      // If process fails, fail closed
      return { action: 'FAIL_CLOSED', resource: 'process_error', ring: 'local' };
    }

    // 4. Parse output as hostile JSON
    let parsed: any;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      return { action: 'FAIL_CLOSED', resource: 'parse_error', ring: 'local' };
    }

    // 5. Validate output shape strictly
    if (!parsed || typeof parsed.action !== 'string' || typeof parsed.resource !== 'string' || typeof parsed.ring !== 'string') {
      return { action: 'FAIL_CLOSED', resource: 'invalid_shape', ring: 'local' };
    }

    // 6. Whitelist fields (strip authorized/verdict)
    const intent: RawIntent = {
      action: parsed.action,
      resource: parsed.resource,
      ring: parsed.ring
    };

    return intent;
  }
}
