import type { I18nContextValue } from '../i18n/context'

type Translate = I18nContextValue['t']

export function translateRunStatus(status: string, t: Translate) {
  switch (status) {
    case 'running':
      return t('studio.runStatus.running')
    case 'completed':
      return t('studio.runStatus.completed')
    case 'failed':
      return t('studio.runStatus.failed')
    case 'cancelled':
      return t('studio.runStatus.cancelled')
    case 'pending':
      return t('studio.runStatus.pending')
    default:
      return status
  }
}

export function translateRenderStatus(status: string, t: Translate) {
  switch (status) {
    case 'queued':
      return t('studio.workStatus.queued')
    case 'running':
      return t('studio.workStatus.running')
    case 'completed':
      return t('studio.workStatus.completed')
    case 'failed':
      return t('studio.workStatus.failed')
    case 'cancelled':
      return t('studio.workStatus.cancelled')
    default:
      return status
  }
}

export function translateEventStatus(status: string, t: Translate) {
  switch (status) {
    case 'connecting':
      return t('studio.event.connecting')
    case 'connected':
      return t('studio.event.connected')
    case 'reconnecting':
      return t('studio.event.reconnecting')
    case 'disconnected':
      return t('studio.event.disconnected')
    default:
      return t('studio.idle')
  }
}

export function translateSnapshotStatus(status: string, t: Translate) {
  switch (status) {
    case 'loading':
      return t('studio.event.snapshotLoading')
    case 'ready':
      return t('studio.event.snapshotReady')
    case 'error':
      return t('studio.workStatus.failed')
    default:
      return t('studio.idle')
  }
}
