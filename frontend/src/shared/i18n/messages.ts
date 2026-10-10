import { appMessages } from './messages/app';
import { studioMessages } from './messages/studio';
import { workflowMessages } from './messages/workflow';
import { workspaceMessages } from './messages/workspace';

export const messages = {
  'zh-CN': {
    ...appMessages['zh-CN'],
    ...workflowMessages['zh-CN'],
    ...workspaceMessages['zh-CN'],
    ...studioMessages['zh-CN'],
  },
  'en-US': {
    ...appMessages['en-US'],
    ...workflowMessages['en-US'],
    ...workspaceMessages['en-US'],
    ...studioMessages['en-US'],
  },
} as const;

export type Locale = keyof typeof messages;
export type TranslationKey = keyof typeof messages['zh-CN'];
