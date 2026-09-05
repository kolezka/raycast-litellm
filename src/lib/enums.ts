/** Temperature presets, matching the upstream raycast-ollama values. */
export enum Creativity {
  None = 0,
  Low = 0.2,
  Medium = 0.8,
  High = 1.5,
  Maximum = 2,
}

/**
 * Storage key per command.
 *
 * Upstream has no BROWSER_SUMMARIZE key — ollama-browser-summarize.tsx reuses
 * CommandAnswer.TWEET, so "Summarize Website" and "Rephrase as Tweet" share one
 * saved model. That is an upstream bug; it is not reproduced here.
 */
export enum CommandName {
  AGENT = "agent",
  BROWSER_SUMMARIZE = "browser-summarize",
  CASUAL = "casual",
  CHAT = "chat",
  CODE_EXPLAIN = "codeexplain",
  CONFIDENT = "confident",
  CUSTOM = "custom",
  EXPLAIN = "explain",
  FIX = "fix",
  FRIENDLY = "friendly",
  IMAGE_DESCRIBE = "imagedescribe",
  IMAGE_TO_TEXT = "image-to-text",
  IMPROVE = "improve",
  LONGER = "longer",
  PROFESSIONAL = "professional",
  SHORTER = "shorter",
  TRANSLATE = "translate",
  TWEET = "tweet",
}
