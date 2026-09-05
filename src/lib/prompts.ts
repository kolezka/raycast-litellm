import { CommandName, Creativity } from "./enums";

export interface PromptDefinition {
  template: string;
  creativity: Creativity;
}

export function fillPlaceholders(template: string, values: { selection?: string; browserTab?: string }): string {
  // One pass over a single alternation, not two chained replaces: chaining makes
  // the second pass scan text the first pass just substituted in, so a selection
  // containing "{browser-tab}" would have the page content injected into the
  // user's own words (or their literal text silently deleted).
  //
  // A replacer function, not a replacement string — otherwise "$&" or "$1"
  // inside the user's selection would be expanded by String.replace.
  return template.replace(
    /\{(selection|browser-tab)\}/g,
    (_match, key: string) => (key === "selection" ? values.selection : values.browserTab) ?? "",
  );
}

export const PROMPTS: Partial<Record<CommandName, PromptDefinition>> = {
  [CommandName.BROWSER_SUMMARIZE]: {
    creativity: Creativity.Low,
    template: `Summarize the provided website with the following format:
"""
## <concise and easy-to-read website title>

<one to two sentence summary with the most important information>

### Key Takeaways

- <EXACTLY three bullet points with the key takeaways, keep the bullet points as short as possible>
"""

Some rules to follow precisely:
- ALWAYS capture the tone, perspective and POV of the author
- NEVER come up with additional information

Here's the website information:
{browser-tab}`,
  },
  [CommandName.CASUAL]: {
    creativity: Creativity.Low,
    template: `Act as a content writer and editor. (replyWithRewrittenText)

Strictly follow these rules:
- Use casual and friendly tone of voice
- Use active voice
- Keep sentences shorts
- Ok to use slang and contractions
- Keep grammatical person
- Correct spelling, grammar, and punctuation
- Keep meaning unchanged
- Keep length retained
- (maintainURLs)
- (maintainOriginalLanguage)

Text: {selection}

Rewritten text:`,
  },
  [CommandName.CODE_EXPLAIN]: {
    creativity: Creativity.Medium,
    template: `Act as a software engineer with deep understanding of any programming language and it's documentation. Explain how the code works step by step in a list. Be concise with a casual tone of voice and write it as documentation for others.

Code: {selection}

Explanation:`,
  },
  [CommandName.CONFIDENT]: {
    creativity: Creativity.Low,
    template: `Act as a content writer and editor. (replyWithRewrittenText)

Strictly follow these rules:
- Use confident, formal and friendly tone of voice
- Avoid hedging, be definite where possible
- Skip apologies
- Focus on main arguments
- Correct spelling, grammar, and punctuation
- Keep meaning unchanged
- Keep length retained
- (maintainURLs)
- (maintainOriginalLanguage)

Text: {selection}

Rewritten text:`,
  },
  [CommandName.EXPLAIN]: {
    creativity: Creativity.Low,
    template: `Act as a dictionary and encyclopedia, providing clear and concise explanations for given words or concepts.

Strictly follow these rules:
- Explain the text in a simple and concise language
  - For a single word, provide a brief, easy-to-understand definition
  - For a concept or phrase, give a concise explanation that breaks down the main ideas into simple terms
- Use examples or analogies to clarify complex topics when necessary
- Only reply with the explanation or definition

Some examples:
Text: Philosophy
Explanation: Philosophy is the study of the fundamental nature of knowledge, reality, and existence. It is a system of ideas that attempts to explain the world and our place in it. Philosophers use logic and reason to explore the meaning of life and the universe.

Text: {selection}

Explanation:`,
  },
  [CommandName.FIX]: {
    creativity: Creativity.Low,
    template: `Act as a spelling corrector and improver. (replyWithRewrittenText)

Strictly follow these rules:
- Correct spelling, grammar and punctuation
- (maintainOriginalLanguage)
- NEVER surround the rewritten text with quotes
- (maintainURLs)
- Don't change emojis

Text: {selection}

Fixed Text:`,
  },
  [CommandName.FRIENDLY]: {
    creativity: Creativity.Low,
    template: `Act as a content writer and editor. (replyWithRewrittenText)

Strictly follow these rules:
- Friendly and optimistic tone of voice
- Correct spelling, grammar, and punctuation
- Meaning unchanged
- Length retained
- (maintainURLs)
- (maintainOriginalLanguage)

Text: {selection}

Rewritten text:`,
  },
  [CommandName.IMPROVE]: {
    creativity: Creativity.Low,
    template: `Act as a spelling corrector, content writer, and text improver/editor. Reply to each message only with the rewritten text
Stricly follow these rules:
- Correct spelling, grammar, and punctuation errors in the given text
- Enhance clarity and conciseness without altering the original meaning
- Divide lengthy sentences into shorter, more readable ones
- Eliminate unnecessary repetition while preserving important points
- Prioritize active voice over passive voice for a more engaging tone
- Opt for simpler, more accessible vocabulary when possible
- ALWAYS ensure the original meaning and intention of the given text
- (maintainOriginalLanguage)
- ALWAYS maintain the existing tone of voice and style, e.g. formal, casual, polite, etc.
- NEVER surround the improved text with quotes or any additional formatting
- If the text is already well-written and requires no improvement, don't change the given text

Text: {selection}

Improved Text:`,
  },
  // The two image prompts are original, not ported: Appendix A carries no
  // upstream wording for them, and they take no {selection} — their input is
  // the attached image.
  [CommandName.IMAGE_DESCRIBE]: {
    creativity: Creativity.Low,
    template: `Describe what is in this image.

Strictly follow these rules:
- Lead with one sentence naming what the image is
- Then describe the notable contents: objects, people, text, layout, colours
- Describe only what is visible; NEVER speculate about context you cannot see
- If the image is a screenshot, describe the interface and what it shows
- Only reply with the description`,
  },
  [CommandName.IMAGE_TO_TEXT]: {
    creativity: Creativity.None,
    template: `Transcribe every piece of text visible in this image.

Strictly follow these rules:
- Reproduce the text verbatim, preserving line breaks and reading order
- Preserve the original language; NEVER translate
- Keep tables as tables and lists as lists
- NEVER add commentary, headings or explanation of your own
- If the image contains no text at all, reply with exactly: No text found
- Only reply with the transcription`,
  },
  [CommandName.LONGER]: {
    creativity: Creativity.Low,
    template: `Act as a professional content writer tasked with expanding a client's text while maintaining its essence and style. (replyWithRewrittenText)

Stictly follow these rules:
- ALWAYS preserve the original tone, voice, and language of the text
- Identify and expand the most critical information and key points
- Avoid repetition
- Stay factual close to the provided text
- Keep URLs in their original format without replacing them with markdown links
- Only reply with the expanded text

Text: {selection}

Expanded text:`,
  },
  [CommandName.PROFESSIONAL]: {
    creativity: Creativity.Low,
    template: `Act as a professional content writer and editor. (replyWithRewrittenText)

Strictly follow these rules:
- Professional tone of voice
- Formal language
- Accurate facts
- Correct spelling, grammar, and punctuation
- Concise phrasing
- meaning  unchanged
- Length retained
- (maintainURLs)
(maintainOriginalLanguage)

Text: {selection}

Rewritten text:`,
  },
  [CommandName.SHORTER]: {
    creativity: Creativity.Low,
    template: `Act as a professional content writer tasked with shortening a client's text while maintaining its essence and style. (replyWithRewrittenText)

Strictly follow these rules:
- ALWAYS preserve the original tone, voice, and language of the text
- Identify and retain the most critical information and key points
- Eliminate redundancies and repetitive phrases or sentences
- Keep URLs in their original format without replacing them with markdown links
- Ensure the shortened text flows smoothly and maintains coherence
- Aim to reduce the word count as much as possible without compromising the core meaning and style
- Only reply with the shortend text

Text: {selection}

Shortened text:`,
  },
  [CommandName.TRANSLATE]: {
    creativity: Creativity.Low,
    template: `You are a professional {source} to {target} translator. Your goal is to accurately convey the meaning and nuances of the original {source} text while adhering to {target} grammar, vocabulary, and cultural sensitivities.
Produce only the {target} translation, without any additional explanations or commentary. Please translate the following {source} text into {target}:


{selection}`,
  },
  [CommandName.TWEET]: {
    creativity: Creativity.High,
    template: `You're an expert in the field and have the perfect opportunity to share your ideas and insights with a huge audience!. Rewrite the text as a tweet that is:
- Casual and upbeat
- Creative and catchy
- Focused on key takeaways that challenge the status quo
- Engaging and punchy
- (maintainURLs)
- IMPORTANT: less than 25 words.
- IMPORTANT: doesn't include hash, hashtags and words starting with #, i.e. #innovation #Technology
- (maintainOriginalLanguage)

Text:
The concept of Rayday is simple. Every Friday, everyone can use the day to work on something that benefits Raycast. From new features, to fixing bugs, drafting documentation or tidying up, it’s time for us to take a break from project work. As well as getting creative with our own ideas, it’s a great chance to act on feedback from our users and community too.

Tweet:
⚒️ We hack every Friday – we call it 'Rayday'. Everyone can use the day to work on something that benefits Raycast – aside from normal project work.

Text: {selection}

Tweet:`,
  },
};
