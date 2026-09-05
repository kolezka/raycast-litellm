import { AnswerView } from "./lib/ui/AnswerView/main";
import { CommandName } from "./lib/enums";
import { PROMPTS } from "./lib/prompts";

export default function Command(): React.JSX.Element {
  const p = PROMPTS[CommandName.LONGER];
  if (!p) throw new Error("Missing prompt definition for longer");
  return <AnswerView command={CommandName.LONGER} prompt={p.template} creativity={p.creativity} />;
}
