# raycast-litellm

A Raycast extension that talks to a [LiteLLM](https://docs.litellm.ai/) proxy: chat, text
transformations, and custom prompt commands against whatever models the proxy routes to.

Modelled on the [Ollama AI](https://github.com/raycast/extensions/tree/74199253f634a755c4526bfdc98779d10d7253f9/extensions/raycast-ollama)
extension (MIT). See [NOTICE](NOTICE) for what is derived and what is original.

## Commands

| Command                                                                                     | Input                                                       |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Chat with LiteLLM                                                                           | conversation; ⌘⇧H browses saved ones, ⌘N starts a new one   |
| Describe Content of Image · Get Text from Image                                             | Finder selection, else an image on the clipboard            |
| Explain This in Simple Terms · Explain Code Step by Step                                    | selection/clipboard                                         |
| Fix Spelling and Grammar · Improve Writing · Make Longer · Make Shorter · Rephrase as Tweet | selection/clipboard                                         |
| Change Tone to Casual · Confident · Friendly · Professional                                 | selection/clipboard                                         |
| Translate                                                                                   | selection + two language arguments                          |
| Summarize Website                                                                           | frontmost browser tab (needs the Raycast browser extension) |
| Create Custom Command · Custom Command                                                      | your own prompt, must contain `{selection}`                 |
| Agent                                                                                       | a task the model works on with tools until it is done       |
| Create Skill · Run Skill                                                                    | a saved agent procedure with its own set of tools           |

Two AI tools are exposed to Raycast AI rather than to LiteLLM: **Web Fetch** (reads a URL
as text) and **Web Search** (DuckDuckGo's keyless endpoint, with no API key and no stability
guarantee because it parses browser HTML).

## Requirements

- Raycast (macOS)
- Node.js 22+ (developed on 24.16.0), pnpm
- A reachable LiteLLM proxy and a virtual key

## Setup

The extension is not in the Raycast Store. Store publication requires a pull request into
the public [`raycast/extensions`](https://github.com/raycast/extensions) monorepo, so this
copy is installed locally in development mode.

Raycast must be running. Then clone the repository and start the extension:

```sh
git clone https://github.com/kolezka/raycast-litellm.git
cd raycast-litellm
pnpm install
pnpm dev
```

`pnpm dev` imports the extension into Raycast in development mode. On first run Raycast
prompts for the preferences below.

## Configuration

Configured through Raycast preferences, not environment variables. Raycast launches
extensions from launchd, so a shell environment is not reliably inherited.

| Preference                | Required | Purpose                                                                                                                                                                              |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `baseUrl`                 | yes      | LiteLLM proxy base URL, no trailing slash                                                                                                                                            |
| `apiKey`                  | yes      | Virtual key; stored in Raycast's encrypted preference store                                                                                                                          |
| `defaultModel`            | no       | Model group used when a command has no override. Leave it empty and the first model the proxy lists is used, which is whatever `/model/info` happens to return first, working or not |
| `requestTimeout`          | no       | Seconds before a request fails (default 60)                                                                                                                                          |
| `chatHistoryMessages`     | no       | Prior messages sent as context in Chat (default 20)                                                                                                                                  |
| `resultViewInput`         | no       | Selected text or clipboard as command input                                                                                                                                          |
| `resultViewInputFallback` | no       | Fall back to the other source when the first is empty                                                                                                                                |
| `agentMaxIterations`      | no       | How many tool rounds the agent may take before stopping (default 10)                                                                                                                 |
| `agentWriteTools`         | no       | Allow the agent to write files, paste text and run shell commands. Reading is unaffected (default off)                                                                               |
| `agentShellAllowlist`     | no       | Comma-separated commands the agent may run, e.g. `ls`, `git`, `rg`. Empty disables the shell entirely (default empty)                                                                |

The agent's writing tools are off by default. Turning `Enable Writing Tools` on lets the
agent write files, paste text and run shell commands on your machine. Shell access is also
gated by `Shell Allowlist`, which is empty by default; an empty allowlist means the agent
cannot run any shell command, so enabling writing tools is a deliberate choice, not the
default.

**The API key is never stored in this repository.** It lives only in Raycast's preference
store. Do not add it to a `.env`, a fixture, or a test.

## Notes on the LiteLLM surface

Behaviour verified against a live proxy, and the reason for two design choices:

- **Model discovery prefers `/model/info`, falling back to `/v1/models`.** `/v1/models`
  advertises model groups that have no healthy deployment and fail with HTTP 400 on use.
  `/model/info` also carries `model_info.mode`, which is how embedding models are kept out
  of the chat picker. The fallback exists for non-admin keys, which `/model/info` rejects;
  results from it carry no mode indicator.
- **A 401 does not always mean your key is wrong.** The proxy returns 401 both when it
  refuses your key and when it accepted your key and its own provider credential was then
  refused upstream. Only the second names a model group, and the two are reported
  differently. `Unauthorized` points at the API Key preference, `UpstreamUnauthorized`
  points at the model.
- **Reasoning models stream `delta.reasoning_content`, not `delta.content`.** A client that
  reads only `content` renders an empty answer while such a model is thinking, so reasoning
  deltas are accumulated separately and displayed apart from the answer. With a small
  `max_tokens` budget, a model can spend it all on `reasoning_content` and return HTTP 200
  with empty `content`. The extension sends no `max_tokens`, so this affects manual `curl`
  checks rather than its commands.

Errors are surfaced verbatim rather than papered over: an unhealthy model group reports
that it is unhealthy instead of silently rerouting to a working one.

## Known gaps

Raycast views are checked by hand because this repo has no automated component-test
harness.

- **LiteLLM's `supports_vision` metadata is unreliable as a filter.** It can include
  unusable models and omit working ones. Vision commands therefore offer every chat model
  and let a bad choice fail with an error that names the model. LiteLLM's Ollama adapter
  needs Pillow installed on the proxy to convert images.
- **Custom commands saved without their own model share one setting.** They fall back to
  a single `CommandName.CUSTOM` key; a command saved _with_ a model is unaffected.

## Assets

`assets/icon.png` is a generated placeholder (plain gradient, no mark) and is expected to
be replaced before the extension is used day to day.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
