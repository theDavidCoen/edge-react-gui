import * as React from 'react'

import { useHandler } from '../../hooks/useHandler'
import { lstrings } from '../../locales/strings'
import {
  type ArkadeUserSettings,
  asArkadeUserSettings
} from '../../util/arkade'
import {
  DEFAULT_ARK_SERVER_URL,
  DEFAULT_DELEGATOR_URL
} from '../../util/arkadeDefaults'
import { logActivity } from '../../util/logger'
import { EdgeCard } from '../cards/EdgeCard'
import {
  type CurrencySettingProps,
  maybeCurrencySetting
} from '../hoc/MaybeCurrencySetting'
import { TextInputModal } from '../modals/TextInputModal'
import { Airship } from '../services/AirshipInstance'
import { SettingsHeaderRow } from '../settings/SettingsHeaderRow'
import { SettingsSubHeader } from '../settings/SettingsSubHeader'
import { SettingsSwitchRow } from '../settings/SettingsSwitchRow'
import { SettingsTappableRow } from '../settings/SettingsTappableRow'

type Props = CurrencySettingProps<ArkadeUserSettings, undefined>

const ArkadeUserSettingsComponent: React.FC<Props> = props => {
  const { defaultSetting, onUpdate, setting } = props
  const {
    enableCustomArkServer,
    customArkServerUrl,
    enableDelegate,
    enableCustomDelegate,
    customDelegatorUrl
  } = setting

  const defaultOperator =
    defaultSetting.arkServerUrl !== ''
      ? defaultSetting.arkServerUrl
      : DEFAULT_ARK_SERVER_URL
  const defaultDelegate =
    defaultSetting.defaultDelegatorUrl !== ''
      ? defaultSetting.defaultDelegatorUrl
      : DEFAULT_DELEGATOR_URL

  const operatorUrl =
    enableCustomArkServer && customArkServerUrl.trim() !== ''
      ? customArkServerUrl
      : defaultOperator

  const delegateUrl =
    enableCustomDelegate && customDelegatorUrl.trim() !== ''
      ? customDelegatorUrl
      : defaultDelegate

  const handleToggleCustomOperator = useHandler(async (): Promise<void> => {
    const next = !enableCustomArkServer
    await onUpdate({
      ...setting,
      enableCustomArkServer: next,
      customArkServerUrl:
        next && customArkServerUrl.trim() === ''
          ? defaultOperator
          : customArkServerUrl
    })
    logActivity(`Arkade custom operator: ${String(next)}`)
  })

  const handleEditOperator = useHandler(async (): Promise<void> => {
    const server = await Airship.show<string | undefined>(bridge => (
      <TextInputModal
        autoCapitalize="none"
        autoCorrect={false}
        bridge={bridge}
        initialValue={
          customArkServerUrl !== '' ? customArkServerUrl : defaultOperator
        }
        inputLabel={lstrings.settings_custom_node_url}
        title={lstrings.settings_arkade_edit_operator}
      />
    ))
    if (server == null || server.trim() === '') return
    await onUpdate({
      ...setting,
      enableCustomArkServer: true,
      customArkServerUrl: server.trim()
    })
    logActivity(`Arkade custom operator URL: ${server.trim()}`)
  })

  const handleToggleDelegate = useHandler(async (): Promise<void> => {
    const next = !enableDelegate
    await onUpdate({
      ...setting,
      enableDelegate: next,
      enableCustomDelegate: next ? enableCustomDelegate : false
    })
    logActivity(`Arkade enable delegate: ${String(next)}`)
  })

  const handleToggleCustomDelegate = useHandler(async (): Promise<void> => {
    const next = !enableCustomDelegate
    await onUpdate({
      ...setting,
      enableDelegate: true,
      enableCustomDelegate: next,
      customDelegatorUrl:
        next && customDelegatorUrl.trim() === ''
          ? defaultDelegate
          : customDelegatorUrl
    })
    logActivity(`Arkade custom delegate: ${String(next)}`)
  })

  const handleEditDelegate = useHandler(async (): Promise<void> => {
    const server = await Airship.show<string | undefined>(bridge => (
      <TextInputModal
        autoCapitalize="none"
        autoCorrect={false}
        bridge={bridge}
        initialValue={
          customDelegatorUrl !== '' ? customDelegatorUrl : defaultDelegate
        }
        inputLabel={lstrings.settings_custom_node_url}
        title={lstrings.settings_arkade_edit_delegate}
      />
    ))
    if (server == null || server.trim() === '') return
    await onUpdate({
      ...setting,
      enableDelegate: true,
      enableCustomDelegate: true,
      customDelegatorUrl: server.trim()
    })
    logActivity(`Arkade custom delegate URL: ${server.trim()}`)
  })

  return (
    <>
      <SettingsHeaderRow label={lstrings.settings_arkade_operator_title} />
      <SettingsSubHeader label={lstrings.settings_arkade_operator_info} />
      <EdgeCard sections>
        <SettingsSwitchRow
          label={lstrings.settings_arkade_enable_custom_operator}
          value={enableCustomArkServer}
          onPress={handleToggleCustomOperator}
        />
        {!enableCustomArkServer ? null : (
          <SettingsTappableRow
            label={`${lstrings.settings_arkade_operator_url}:\n${operatorUrl}`}
            onPress={handleEditOperator}
          />
        )}
      </EdgeCard>

      <SettingsHeaderRow label={lstrings.settings_arkade_delegate_title} />
      <SettingsSubHeader label={lstrings.settings_arkade_delegate_info} />
      <EdgeCard sections>
        <SettingsSwitchRow
          label={lstrings.settings_arkade_enable_delegate}
          value={enableDelegate}
          onPress={handleToggleDelegate}
        />
        {!enableDelegate ? null : (
          <>
            <SettingsSwitchRow
              label={lstrings.settings_arkade_enable_custom_delegate}
              value={enableCustomDelegate}
              onPress={handleToggleCustomDelegate}
            />
            {!enableCustomDelegate ? null : (
              <SettingsTappableRow
                label={`${lstrings.settings_arkade_delegate_url}:\n${delegateUrl}`}
                onPress={handleEditDelegate}
              />
            )}
          </>
        )}
      </EdgeCard>
    </>
  )
}

export const MaybeArkadeUserSettings = maybeCurrencySetting(
  ArkadeUserSettingsComponent,
  asArkadeUserSettings,
  undefined
)
