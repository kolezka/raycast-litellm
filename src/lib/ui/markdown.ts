/**
 * Wraps `content` in a fenced code block for a Raycast `Detail`/`List.Item.Detail`
 * markdown pane, sized so nothing inside `content` can prematurely close it.
 *
 * Both `AuditLog.tsx` and `AgentView/main.tsx` embed attacker-influenced text
 * — a tool result, a stored audit entry's raw arguments — inside a fence like
 * this. A plain fixed "```" fence lets a backtick run already in that text
 * close the block early; everything after is then parsed as markdown (a
 * heading, a link, another fence) instead of staying inert text. Choosing a
 * fence longer than any backtick run already in the content is the same fix
 * CommonMark itself relies on for this case.
 */
export function codeFence(content: string, lang = ""): string {
  const longestRun = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${lang}\n${content}\n${fence}`;
}
