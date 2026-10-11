import type { SupabaseClient } from '@supabase/supabase-js'
import type { StudioPersistence } from './studio-persistence'
import { createSupabaseStudioSessionStore } from './supabase-session-repository'
import { createSupabaseStudioMessageStore, createSupabaseStudioPartStore, createSupabaseStudioConversationWriter } from './supabase-message-repository'
import { createSupabaseStudioRunStore } from './supabase-run-repository'
import { createSupabaseStudioRenderStore } from './supabase-render-repository'
import { createSupabaseStudioSceneStore } from './supabase-scene-repository'

export function createSupabaseStudioPersistence(client: SupabaseClient): StudioPersistence {
  return {
    conversationWriter: createSupabaseStudioConversationWriter(client),
    sessionStore: createSupabaseStudioSessionStore(client),
    messageStore: createSupabaseStudioMessageStore(client),
    partStore: createSupabaseStudioPartStore(client),
    runStore: createSupabaseStudioRunStore(client),
    renderStore: createSupabaseStudioRenderStore(client),
    sceneStore: createSupabaseStudioSceneStore(client),
  }
}
