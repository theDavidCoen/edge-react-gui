import type { JsonObject } from 'edge-core-js'
import * as React from 'react'
import { Linking, Platform, Switch, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view'
import { sprintf } from 'sprintf-js'

import { PLACEHOLDER_WALLET_ID } from '../../actions/CreateWalletActions'
import ImportKeySvg from '../../assets/images/import-key-icon.svg'
import {
  type ImportKeyOption,
  SPECIAL_CURRENCY_INFO
} from '../../constants/WalletAndCurrencyConstants'
import { useHandler } from '../../hooks/useHandler'
import { lstrings } from '../../locales/strings'
import {
  splitCreateWalletItems,
  type WalletCreateItem
} from '../../selectors/getCreateWalletList'
import { useSelector } from '../../types/reactRedux'
import type { EdgeAppSceneProps } from '../../types/routerTypes'
import { SceneButtons } from '../buttons/SceneButtons'
import { EdgeTouchableOpacity } from '../common/EdgeTouchableOpacity'
import { SceneWrapper } from '../common/SceneWrapper'
import { CryptoIcon } from '../icons/CryptoIcon'
import { InformationCircleIcon } from '../icons/ThemedIcons'
import { ButtonsModal } from '../modals/ButtonsModal'
import { Airship, showError } from '../services/AirshipInstance'
import { cacheStyles, type Theme, useTheme } from '../services/ThemeContext'
import { EdgeText, Paragraph } from '../themed/EdgeText'
import {
  FilledTextInput,
  type FilledTextInputRef
} from '../themed/FilledTextInput'
import { SceneHeaderUi4 } from '../themed/SceneHeaderUi4'

export interface CreateWalletImportParams {
  createWalletList: WalletCreateItem[]
  walletNames: Record<string, string>
  walletSettingValues?: Record<string, Record<string, string>>
}

interface Props extends EdgeAppSceneProps<'createWalletImport'> {}

const getOptionKey = (pluginId: string, opt: ImportKeyOption): string =>
  `${pluginId}${opt.optionName}`

const hasUtxoImport = (createWalletList: WalletCreateItem[]): boolean =>
  createWalletList.some(item => {
    if (item.tokenId != null) return false
    const { maxSpendTargets } = SPECIAL_CURRENCY_INFO[item.pluginId] ?? {}
    return maxSpendTargets != null
  })

const looksLikeXpub = (text: string): boolean => {
  const lower = text.trim().toLowerCase()
  return /^(xpub|ypub|zpub|tpub|upub|vpub|ypub|zpub)/.test(lower)
}

const CreateWalletImportComponent = (props: Props): React.JSX.Element => {
  const { navigation, route } = props
  const { createWalletList, walletNames, walletSettingValues } = route.params
  const theme = useTheme()
  const styles = getStyles(theme)

  const account = useSelector(state => state.core.account)
  const { currencyConfig } = account

  const showUtxoExtendedImport = React.useMemo(
    () => hasUtxoImport(createWalletList),
    [createWalletList]
  )

  const [importText, setImportText] = React.useState('')
  const [usePassphrase, setUsePassphrase] = React.useState(false)
  const [passphrase, setPassphrase] = React.useState('')
  const [slip39Shares, setSlip39Shares] = React.useState<string[]>([])

  const textInputRef = React.useRef<FilledTextInputRef>(null)

  // Build the set of import options per plugin from the create list
  const importOpts = React.useMemo<Map<string, Set<ImportKeyOption>>>(() => {
    const pluginIdMap = new Map<string, Set<ImportKeyOption>>()

    for (const createItem of createWalletList) {
      const { pluginId, tokenId } = createItem
      const { importKeyOptions } = SPECIAL_CURRENCY_INFO[pluginId] ?? {}
      if (importKeyOptions == null || tokenId != null) continue

      if (!pluginIdMap.has(pluginId)) {
        pluginIdMap.set(pluginId, new Set(importKeyOptions))
      }
    }

    return pluginIdMap
  }, [createWalletList])

  // Track each option's current value and validation error state
  const [optionValues, setOptionValues] = React.useState<
    Map<string, { value: string; error: boolean }>
  >(() => {
    const valueMap = new Map<string, { value: string; error: boolean }>()
    for (const [pluginId, opts] of importOpts.entries()) {
      opts.forEach(opt => {
        valueMap.set(getOptionKey(pluginId, opt), { value: '', error: false })
      })
    }
    return valueMap
  })

  const disableNextButton =
    (slip39Shares.length > 0 ? false : importText.trim() === '') ||
    ![...importOpts.entries()].every(([pluginId, opts]) => {
      for (const opt of [...opts]) {
        const key = getOptionKey(pluginId, opt)
        const input = optionValues.get(key)
        if (input == null) continue

        if (input.error || (input.value === '' && opt.required)) {
          return false
        }
      }

      return true
    })

  const handleOptionChange = useHandler(
    (input: string, pluginId: string, opt: ImportKeyOption) => {
      const key = getOptionKey(pluginId, opt)

      if (input === '' || opt.inputValidation(input)) {
        setOptionValues(
          map => new Map(map.set(key, { value: input, error: false }))
        )
      } else {
        setOptionValues(
          map => new Map(map.set(key, { value: input, error: true }))
        )
      }
    }
  )

  const handleAddSlip39Share = useHandler(() => {
    const cleanShare = cleanupImportText(importText)
    if (cleanShare === '') return
    setSlip39Shares(prev => [...prev, cleanShare])
    setImportText('')
  })

  const handleRemoveSlip39Share = useHandler((index: number) => {
    setSlip39Shares(prev => prev.filter((_, i) => i !== index))
  })

  const handleNext = useHandler(async () => {
    textInputRef.current?.blur()

    // Include the share still in the text field (user often taps Next
    // instead of "Add share" for the last share).
    const pendingShare = cleanupImportText(importText)
    const effectiveSlip39Shares = [...slip39Shares]
    if (
      showUtxoExtendedImport &&
      pendingShare !== '' &&
      pendingShare.split(/\s+/).length >= 20 &&
      !effectiveSlip39Shares.includes(pendingShare)
    ) {
      effectiveSlip39Shares.push(pendingShare)
    }
    const isSlip39Import = effectiveSlip39Shares.length > 0
    const cleanImportText = isSlip39Import
      ? effectiveSlip39Shares[0]
      : pendingShare

    // Keep UI in sync if we consumed the pending share
    if (effectiveSlip39Shares.length > slip39Shares.length) {
      setSlip39Shares(effectiveSlip39Shares)
      setImportText('')
    }

    // Build keyOptions from the option values
    const allKeyOptions = new Map<string, Record<string, string | undefined>>()
    importOpts.forEach((opts, pluginId) => {
      const keyOptions: Record<string, string | undefined> = {}
      for (const opt of opts) {
        const value = optionValues.get(getOptionKey(pluginId, opt))
        const input =
          value != null && value.value !== '' ? value.value : undefined
        keyOptions[opt.optionName] = input
      }
      if (showUtxoExtendedImport) {
        keyOptions.importMode = 'auto'
        if (usePassphrase && passphrase !== '') {
          keyOptions.passphrase = passphrase
        }
        if (isSlip39Import) {
          keyOptions.importMode = 'slip39'
          keyOptions.slip39Shares = JSON.stringify(effectiveSlip39Shares)
          // SLIP39 uses its own passphrase extension (not BIP39 25th word).
          if (usePassphrase && passphrase !== '') {
            keyOptions.slip39Passphrase = passphrase
          }
        }
      }
      allKeyOptions.set(pluginId, keyOptions)
    })

    // Also attach UTXO options when the plugins have no custom importKeyOptions
    if (showUtxoExtendedImport) {
      const { newWalletItems } = splitCreateWalletItems(createWalletList)
      for (const item of newWalletItems) {
        if (allKeyOptions.has(item.pluginId)) continue
        const keyOptions: Record<string, string | undefined> = {
          importMode: isSlip39Import ? 'slip39' : 'auto'
        }
        if (usePassphrase && passphrase !== '') {
          keyOptions.passphrase = passphrase
        }
        if (isSlip39Import) {
          keyOptions.slip39Shares = JSON.stringify(effectiveSlip39Shares)
          if (usePassphrase && passphrase !== '') {
            keyOptions.slip39Passphrase = passphrase
          }
        }
        allKeyOptions.set(item.pluginId, keyOptions)
      }
    }

    // Test imports
    const { newWalletItems } = splitCreateWalletItems(createWalletList)

    const pluginIds = newWalletItems.map(item => item.pluginId)

    const promises = pluginIds.map(async pluginId => {
      const keyOptions = allKeyOptions.get(pluginId)
      const opts = keyOptions != null ? { keyOptions } : undefined
      return await currencyConfig[pluginId]
        .importKey(cleanImportText, opts)
        .catch((e: unknown) => {
          showError(e)
          console.warn('importKey failed', e)
        })
    })

    const results = await Promise.all(promises)

    const successMap: Record<string, JsonObject> = {}

    for (const [i, keys] of results.entries()) {
      if (typeof keys === 'object') {
        // Success
        successMap[pluginIds[i]] = keys
      }
    }

    // Split up the original list of create items into success and failure lists
    const failureItems: WalletCreateItem[] = []
    const successItems: WalletCreateItem[] = []

    for (const item of createWalletList) {
      if (successMap[item.pluginId] != null) {
        // Any asset associated to this pluginId is good to go
        successItems.push(item)
      } else if (
        item.createWalletIds != null &&
        item.createWalletIds[0] === PLACEHOLDER_WALLET_ID
      ) {
        // Token items to be enabled on existing wallets and aren't dependent on a failed import are are good to go, too
        successItems.push(item)
      } else {
        // No good
        failureItems.push(item)
      }
    }

    if (successItems.length === 0) {
      await Airship.show<'edit' | undefined>(bridge => (
        <ButtonsModal
          bridge={bridge}
          title={lstrings.create_wallet_failed_import_header}
          message={lstrings.create_wallet_all_failed}
          buttons={{
            edit: { label: lstrings.create_wallet_edit }
          }}
        />
      ))

      return
    }

    if (failureItems.length > 0) {
      // Show modal with errors
      const displayNames = failureItems.map(item => item.displayName).join(', ')
      const resolveValue = await Airship.show<
        'continue' | 'edit' | 'cancel' | undefined
      >(bridge => (
        <ButtonsModal
          bridge={bridge}
          title={lstrings.create_wallet_failed_import_header}
          message={sprintf(lstrings.create_wallet_some_failed, displayNames)}
          buttons={{
            continue: { label: lstrings.legacy_address_modal_continue },
            cancel: { label: lstrings.string_cancel_cap }
          }}
        />
      ))

      if (resolveValue === 'cancel' || resolveValue == null) {
        return
      }
    }

    navigation.navigate('createWalletCompletion', {
      createWalletList: successItems,
      walletNames,
      importText: cleanImportText,
      keyOptions: allKeyOptions.size > 0 ? allKeyOptions : undefined,
      walletSettingValues
    })
  })

  // Scale the icon
  const svgHeight = React.useMemo(() => 36 * theme.rem(0.0625), [theme])
  const svgWidth = React.useMemo(() => 83 * theme.rem(0.0625), [theme])

  // Hack to disable autocomplete since RN sometimes enables it even when not specified
  // https://www.reddit.com/r/reactnative/comments/rt1who/cant_turn_off_autocomplete_in_textinput_android/

  const keyboardType = Platform.OS === 'ios' ? 'email-address' : undefined

  const importOptsEntries = React.useMemo(
    () => [...importOpts.entries()],
    [importOpts]
  )

  const showPassphraseToggle =
    showUtxoExtendedImport && !looksLikeXpub(importText)

  return (
    <SceneWrapper>
      <View style={styles.container}>
        {/* We have to use the SceneHeaderUi4 component here because
        the SceneContainer component does not implement the specific flex
        styles we need for this scene's container. These styles are a
        one-off case which has not been codified into our design hierarchy
        and made it completely into our abstraction (SceneContainer). */}
        <SceneHeaderUi4 title={lstrings.create_wallet_import_title} />
        <KeyboardAwareScrollView keyboardShouldPersistTaps="handled">
          <View style={styles.icon}>
            <ImportKeySvg
              accessibilityHint={lstrings.import_key_icon_hint}
              color={theme.iconTappable}
              height={svgHeight}
              width={svgWidth}
            />
          </View>
          <Paragraph>
            {showUtxoExtendedImport
              ? lstrings.create_wallet_import_utxo_auto_instructions
              : lstrings.create_wallet_import_all_instructions}
          </Paragraph>
          {showPassphraseToggle ? (
            <>
              <View style={styles.passphraseRow}>
                <EdgeText style={styles.passphraseLabel}>
                  {lstrings.create_wallet_import_utxo_passphrase_toggle}
                </EdgeText>
                <Switch
                  value={usePassphrase}
                  onValueChange={setUsePassphrase}
                />
              </View>
              {usePassphrase ? (
                <>
                  <FilledTextInput
                    aroundRem={0.5}
                    value={passphrase}
                    placeholder={
                      lstrings.create_wallet_import_options_passphrase
                    }
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                    onChangeText={setPassphrase}
                  />
                  <EdgeText style={styles.passphraseHint}>
                    {lstrings.create_wallet_import_utxo_passphrase_hint}
                  </EdgeText>
                </>
              ) : null}
            </>
          ) : null}
          {showUtxoExtendedImport && slip39Shares.length > 0 ? (
            <>
              <EdgeText style={styles.sectionTitle}>
                {lstrings.create_wallet_import_slip39_title}
              </EdgeText>
              <EdgeText style={styles.passphraseHint}>
                {sprintf(
                  lstrings.create_wallet_import_slip39_count,
                  String(slip39Shares.length)
                )}
              </EdgeText>
              {slip39Shares.map((share, index) => (
                <View
                  key={`${index}-${share.slice(0, 8)}`}
                  style={styles.shareRow}
                >
                  <EdgeText style={styles.shareText} numberOfLines={2}>
                    {`${index + 1}. ${share}`}
                  </EdgeText>
                  <EdgeTouchableOpacity
                    onPress={() => {
                      handleRemoveSlip39Share(index)
                    }}
                  >
                    <EdgeText style={styles.shareRemove}>
                      {lstrings.create_wallet_import_slip39_remove}
                    </EdgeText>
                  </EdgeTouchableOpacity>
                </View>
              ))}
            </>
          ) : null}
          <FilledTextInput
            aroundRem={0.5}
            keyboardType={keyboardType}
            value={importText}
            multiline
            numberOfLines={10}
            placeholder={
              looksLikeXpub(importText)
                ? lstrings.create_wallet_import_xpub_prompt
                : lstrings.create_wallet_import_input_key_or_seed_prompt
            }
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            onChangeText={setImportText}
            returnKeyType="none"
            ref={textInputRef}
          />
          {showUtxoExtendedImport &&
          importText.trim().split(/\s+/).length >= 20 ? (
            <EdgeTouchableOpacity
              style={styles.addShareButton}
              onPress={handleAddSlip39Share}
            >
              <EdgeText style={styles.addShareButtonText}>
                {lstrings.create_wallet_import_slip39_add}
              </EdgeText>
            </EdgeTouchableOpacity>
          ) : null}
          {importOptsEntries.length > 0 ? (
            <EdgeText style={styles.optionsHeading}>
              {lstrings.create_wallet_import_options_title}
            </EdgeText>
          ) : null}
          {importOptsEntries.map(([pluginId, opts]) => (
            <View key={pluginId} style={styles.optionContainer}>
              {importOptsEntries.length > 1 ? (
                <View style={styles.optionHeader}>
                  <CryptoIcon
                    sizeRem={1.25}
                    pluginId={pluginId}
                    tokenId={null}
                  />
                  <EdgeText style={styles.pluginIdText}>
                    {currencyConfig[pluginId].currencyInfo.displayName}
                  </EdgeText>
                </View>
              ) : null}
              {[...opts].map(opt => {
                const key = getOptionKey(pluginId, opt)
                const item = optionValues.get(key)
                if (item == null) return null

                const { value, error } = item
                const { knowledgeBaseUri } = opt.displayDescription ?? {}

                const returnKeyType =
                  opt.inputType === 'number-pad' && Platform.OS === 'ios'
                    ? undefined
                    : 'done'

                return (
                  <View key={key} style={styles.optionRow}>
                    <FilledTextInput
                      aroundRem={0.5}
                      expand
                      placeholder={`${opt.displayName}${
                        opt.required ? ` (${lstrings.fragment_required})` : ''
                      }`}
                      value={value}
                      error={
                        error ? lstrings.create_wallet_invalid_input : undefined
                      }
                      keyboardType={opt.inputType}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="off"
                      onChangeText={(text: string) => {
                        handleOptionChange(text, pluginId, opt)
                      }}
                      returnKeyType={returnKeyType}
                    />
                    {knowledgeBaseUri != null ? (
                      <EdgeTouchableOpacity
                        style={styles.infoButton}
                        onPress={() => {
                          Linking.openURL(knowledgeBaseUri).catch(
                            (err: unknown) => {
                              showError(err)
                            }
                          )
                        }}
                      >
                        <InformationCircleIcon
                          size={theme.rem(1.25)}
                          color={theme.iconTappable}
                        />
                      </EdgeTouchableOpacity>
                    ) : null}
                  </View>
                )
              })}
            </View>
          ))}
          <SceneButtons
            primary={{
              label: lstrings.string_next_capitalized,
              disabled: disableNextButton,
              onPress: handleNext
            }}
          />
        </KeyboardAwareScrollView>
      </View>
    </SceneWrapper>
  )
}

const getStyles = cacheStyles((theme: Theme) => ({
  container: {
    flexShrink: 1,
    margin: theme.rem(0.5)
  },
  icon: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginVertical: theme.rem(2)
  },
  optionsHeading: {
    fontSize: theme.rem(1),
    marginTop: theme.rem(1.5),
    marginLeft: theme.rem(0.5),
    marginBottom: theme.rem(0.5)
  },
  optionContainer: {
    marginTop: theme.rem(0.5)
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: theme.rem(0.5),
    marginBottom: theme.rem(0.5)
  },
  pluginIdText: {
    fontSize: theme.rem(1),
    marginLeft: theme.rem(0.5)
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  infoButton: {
    padding: theme.rem(0.5)
  },
  sectionTitle: {
    fontSize: theme.rem(0.875),
    marginTop: theme.rem(1),
    marginLeft: theme.rem(0.5),
    marginBottom: theme.rem(0.25)
  },
  passphraseRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: theme.rem(0.5),
    paddingHorizontal: theme.rem(0.5)
  },
  passphraseLabel: {
    flex: 1,
    fontSize: theme.rem(0.8),
    marginRight: theme.rem(0.5)
  },
  passphraseHint: {
    marginHorizontal: theme.rem(0.5),
    marginBottom: theme.rem(0.5)
  },
  shareRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: theme.rem(0.25),
    paddingHorizontal: theme.rem(0.5)
  },
  shareText: {
    flex: 1,
    fontSize: theme.rem(0.75)
  },
  shareRemove: {
    color: theme.iconTappable,
    fontSize: theme.rem(0.75)
  },
  addShareButton: {
    alignSelf: 'flex-start',
    marginBottom: theme.rem(0.5),
    marginLeft: theme.rem(0.5),
    padding: theme.rem(0.5)
  },
  addShareButtonText: {
    color: theme.iconTappable,
    fontSize: theme.rem(0.875)
  }
}))

export const CreateWalletImportScene = React.memo(CreateWalletImportComponent)

export const cleanupImportText = (importText: string): string => {
  const trimmed = importText.trim()
  if (!trimmed.includes(' ') && !trimmed.includes('\n')) return trimmed
  // Normalize whitespace (newlines / multi-space) for mnemonics & SLIP39 shares
  return trimmed
    .split(/\s+/)
    .filter(part => part !== '')
    .map(word => word.toLowerCase())
    .join(' ')
}
