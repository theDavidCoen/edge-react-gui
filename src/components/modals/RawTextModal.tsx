import Clipboard from '@react-native-clipboard/clipboard'
import * as React from 'react'
import { Platform } from 'react-native'
import type { AirshipBridge } from 'react-native-airship'
import RNFS from 'react-native-fs'
import Share, { type ShareOptions } from 'react-native-share'

import { lstrings } from '../../locales/strings'
import { showError, showToast } from '../services/AirshipInstance'
import { Paragraph } from '../themed/EdgeText'
import { MainButton } from '../themed/MainButton'
import { EdgeModal } from './EdgeModal'

export interface ShareFile {
  filename: string
  contents: string
}

interface Props {
  bridge: AirshipBridge<void>
  body: string
  title?: string
  disableCopy?: boolean
  shareFilename?: string
  shareFiles?: ShareFile[]
}

export const RawTextModal: React.FC<Props> = props => {
  const {
    bridge,
    body,
    title,
    disableCopy = false,
    shareFilename,
    shareFiles
  } = props
  const files: ShareFile[] =
    shareFiles ??
    (shareFilename != null ? [{ filename: shareFilename, contents: body }] : [])

  const handleCancel = (): void => {
    bridge.resolve(undefined)
  }
  const handleCopy = (): void => {
    Clipboard.setString(body)
    showToast(lstrings.fragment_copied)
    bridge.resolve()
  }
  const handleShare = async (): Promise<void> => {
    if (files.length === 0) return
    try {
      const dir =
        Platform.OS === 'android'
          ? RNFS.ExternalCachesDirectoryPath
          : RNFS.DocumentDirectoryPath
      const urls: string[] = []
      for (const file of files) {
        const path = `${dir}/${file.filename}`
        await RNFS.writeFile(path, file.contents, 'utf8')
        urls.push(`file://${path}`)
      }
      const shareOptions: ShareOptions = {
        title: files[0].filename,
        subject: files[0].filename,
        message: '',
        urls,
        type: 'text/plain',
        failOnCancel: false
      }
      await Share.open(shareOptions)
      bridge.resolve()
    } catch (error: unknown) {
      showError(error)
    }
  }

  return (
    <EdgeModal bridge={bridge} title={title} scroll onCancel={handleCancel}>
      <Paragraph selectable>{body}</Paragraph>
      {disableCopy ? null : (
        <MainButton
          label={lstrings.fragment_request_copy_title}
          marginRem={1}
          onPress={handleCopy}
          type="secondary"
        />
      )}
      {files.length === 0 ? null : (
        <MainButton
          label={lstrings.string_share}
          marginRem={[0, 1, 1, 1]}
          onPress={handleShare}
          type="secondary"
        />
      )}
    </EdgeModal>
  )
}
