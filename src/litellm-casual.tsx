import { AnswerView } from "./lib/ui/AnswerView/main";
import { CommandName } from "./lib/enums";
import { PROMPTS } from "./lib/prompts";

export default function Command(): React.JSX.Element {
  const p = PROMPTS[CommandName.CASUAL];
  if (!p) throw new Error("Missing prompt definition for casual");
  return <AnswerView command={CommandName.CASUAL} prompt={p.template} creativity={p.creativity} />;
}
