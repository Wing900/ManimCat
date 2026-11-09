import type OpenAI from 'openai'
import type { ReferenceImage } from '../../types'

/** Every creative stage receives the original image parts alongside its text. */
export function buildVisionUserMessage(
  userPrompt: string,
  referenceImages?: ReferenceImage[]
): OpenAI.Chat.Completions.ChatCompletionUserMessageParam['content'] {
  if (!referenceImages?.length) return userPrompt

  return [
    {
      type: 'text',
      text: `${userPrompt}\n\nReference images are part of the original user input. Preserve the requirements expressed in both the text and images.`
    },
    ...referenceImages.map((image) => ({
      type: 'image_url' as const,
      image_url: { url: image.url, detail: image.detail || 'auto' as const }
    }))
  ]
}
