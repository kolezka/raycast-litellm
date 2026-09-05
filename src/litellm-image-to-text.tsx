import { VisionCommand } from "./lib/ui/VisionCommand";
import { CommandName } from "./lib/enums";

export default function Command(): React.JSX.Element {
  return <VisionCommand command={CommandName.IMAGE_TO_TEXT} />;
}
