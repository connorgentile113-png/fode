export function parseAction(text, nonce) {
  // Only explicit, complete blocks from the current managed response are actionable.
  const blocks = [...text.matchAll(/```fode\s*\n([\s\S]*?)\n```/g)];
  if (!blocks.length) return null;
  if (blocks.length !== 1) throw new Error('Use exactly one fode block per response');
  const value = JSON.parse(blocks[0][1]);
  if (value.nonce !== nonce) throw new Error('Stale or invalid run nonce');
  if (!['codex', 'shell', 'done'].includes(value.tool)) throw new Error('Unknown tool');
  const field = value.tool === 'shell' ? 'command' : value.tool === 'codex' ? 'prompt' : 'summary';
  if (typeof value[field] !== 'string' || !value[field].trim() || value[field].length > 100_000) throw new Error(`Invalid ${field}`);
  return value;
}
export function instruction(job) {
  return `You are connected to Fode, a Linux terminal harness powered by the user's real Codex agent. Work on the following task using the harness. To request work, output exactly one fenced code block with language fode and JSON {"nonce":"${job.nonce}","tool":"codex","prompt":"your detailed task"}. Codex has its configured terminal, file editing, search, skills and MCP tools. To request a terminal command use {"nonce":"${job.nonce}","tool":"shell","command":"command here"}; Codex will execute it under the configured permissions. Wait for the harness result before requesting another operation. When finished use {"nonce":"${job.nonce}","tool":"done","summary":"result"}. Never invent terminal output. Only request operations needed for this user's task.\n\nWorking directory: ${job.cwd}\nTask: ${job.prompt}`;
}
