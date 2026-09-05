import { AnswerView } from "./lib/ui/AnswerView/main";
import { CommandName } from "./lib/enums";
import { PROMPTS } from "./lib/prompts";

export default function Command(): React.JSX.Element {
  const p = PROMPTS[CommandName.CODE_EXPLAIN];
  if (!p) throw new Error("Missing prompt definition for code-explain");
  return <AnswerView command={CommandName.CODE_EXPLAIN} prompt={p.template} creativity={p.creativity} />;
}
