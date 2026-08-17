import * as React from 'react'
import { View } from 'react-native'
import { sprintf } from 'sprintf-js'

import { startMultisigWallet } from '../../actions/MultisigActions'
import { useHandler } from '../../hooks/useHandler'
import { useMount } from '../../hooks/useMount'
import { lstrings } from '../../locales/strings'
import type { MainWalletCreateItem } from '../../selectors/getCreateWalletList'
import { useDispatch, useSelector } from '../../types/reactRedux'
import type { EdgeAppSceneProps } from '../../types/routerTypes'
import { isXpubLike } from '../../util/multisig/types'
import { isValidNpub } from '../../util/nostr/bech32Keys'
import { ensureNostrIdentity } from '../../util/nostr/identity'
import { isNip05Like, resolveCosignerNostrInput } from '../../util/nostr/nip05'
import {
  fetchNostrProfiles,
  formatNip05Display,
  getCachedNostrProfile,
  refreshOwnNostrProfile
} from '../../util/nostr/profile'
import { ButtonsView } from '../buttons/ButtonsView'
import { EdgeCard } from '../cards/EdgeCard'
import { SceneWrapper } from '../common/SceneWrapper'
import { Space } from '../layout/Space'
import { EdgeRow } from '../rows/EdgeRow'
import { showError, showToast } from '../services/AirshipInstance'
import { cacheStyles, type Theme, useTheme } from '../services/ThemeContext'
import { SettingsRadioRow } from '../settings/SettingsRadioRow'
import { EdgeText, Paragraph } from '../themed/EdgeText'
import { FilledTextInput } from '../themed/FilledTextInput'
import {
  hasNostrFriendlyLabel,
  useResolvedNostrLabel
} from '../themed/NostrNpubLabel'
import { SafeSlider } from '../themed/SafeSlider'
import { SceneHeader } from '../themed/SceneHeader'

export interface CreateWalletMultisigParams {
  createItem: MainWalletCreateItem
  walletName?: string
}

interface Props extends EdgeAppSceneProps<'createWalletMultisig'> {}

type InviteMode = 'npub' | 'xpub'

/**
 * xpub invite remains implemented in `startMultisigWallet` for a possible
 * future opt-in, but from-scratch creation is Edge-user-only (npub / NIP-05).
 * Pasting foreign xpubs would let low-entropy keys from other apps (see the
 * Coincard case) into a new multisig. Set true to restore the xpub radio.
 */
const ENABLE_MULTISIG_XPUB_INVITE = false

interface CosignerNpubFieldProps {
  index: number
  value: string
  onChangeText: (text: string) => void
}

interface ResolvedCosigner {
  input: string
  npub: string
  nip05?: string
}

const CosignerNpubField: React.FC<CosignerNpubFieldProps> = props => {
  const { index, value, onChangeText } = props
  const theme = useTheme()
  const styles = getStyles(theme)
  const valid = isValidNpub(value)
  const label = useResolvedNostrLabel(valid ? value : undefined)

  return (
    <View>
      <FilledTextInput
        topRem={1}
        value={value}
        onChangeText={onChangeText}
        placeholder={sprintf(
          lstrings.multisig_cosigner_npub_or_nip05_s,
          String(index + 1)
        )}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="next"
      />
      {valid && hasNostrFriendlyLabel(value) ? (
        <EdgeText style={styles.hint}>{label}</EdgeText>
      ) : isNip05Like(value) ? (
        <EdgeText style={styles.hint}>
          {formatNip05Display(value.trim())}
        </EdgeText>
      ) : null}
    </View>
  )
}

export const CreateWalletMultisigScene: React.FC<Props> = props => {
  const { navigation, route } = props
  const { createItem, walletName } = route.params
  const dispatch = useDispatch()
  const theme = useTheme()
  const styles = getStyles(theme)
  const account = useSelector(state => state.core.account)

  const [npub, setNpub] = React.useState('')
  const [totalCosigners, setTotalCosigners] = React.useState('3')
  const [requiredSignatures, setRequiredSignatures] = React.useState('2')
  const [mode, setMode] = React.useState<InviteMode>('npub')
  const [cosignerValues, setCosignerValues] = React.useState<string[]>(['', ''])
  const [resolvedCosigners, setResolvedCosigners] = React.useState<
    ResolvedCosigner[]
  >([])
  const [step, setStep] = React.useState<'form' | 'review'>('form')
  const [busy, setBusy] = React.useState(false)

  const ownLabel = useResolvedNostrLabel(npub !== '' ? npub : undefined)

  useMount(() => {
    ensureNostrIdentity(account)
      .then(async identity => {
        setNpub(identity.npub)
        await refreshOwnNostrProfile(account)
      })
      .catch((error: unknown) => {
        showError(error)
      })
  })

  const parsedTotal = Number(totalCosigners)
  const otherCount = Math.max(
    1,
    Number.isFinite(parsedTotal) ? parsedTotal - 1 : 1
  )

  React.useEffect(() => {
    setCosignerValues(prev => {
      if (prev.length === otherCount) return prev
      const next = prev.slice(0, otherCount)
      while (next.length < otherCount) next.push('')
      return next
    })
  }, [otherCount])

  React.useEffect(() => {
    if (mode !== 'npub') return
    const npubs = cosignerValues.filter(isValidNpub)
    if (npubs.length === 0) return
    fetchNostrProfiles(npubs).catch(() => {})
  }, [cosignerValues, mode])

  React.useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', event => {
      if (step !== 'review' || busy) return
      event.preventDefault()
      setStep('form')
    })
    return unsubscribe
  }, [busy, navigation, step])

  const handleTotalChange = useHandler((text: string) => {
    const digits = text.replace(/[^0-9]/g, '')
    setTotalCosigners(digits)
    const n = Number(digits)
    const m = Number(requiredSignatures)
    if (Number.isFinite(n) && Number.isFinite(m) && m > n) {
      setRequiredSignatures(String(n))
    }
  })

  const handleRequiredChange = useHandler((text: string) => {
    setRequiredSignatures(text.replace(/[^0-9]/g, ''))
  })

  const handleCosignerChange = useHandler((index: number, text: string) => {
    setCosignerValues(prev => {
      const next = [...prev]
      next[index] = text.trim()
      return next
    })
  })

  const parseCounts = (): { m: number; n: number } | undefined => {
    const n = Number(totalCosigners)
    const m = Number(requiredSignatures)
    if (!Number.isFinite(n) || n < 2 || n > 15) {
      showError(lstrings.multisig_invalid_cosigner_count)
      return undefined
    }
    if (!Number.isFinite(m) || m < 1 || m > n) {
      showError(lstrings.multisig_invalid_signature_count)
      return undefined
    }
    if (cosignerValues.length !== n - 1) {
      showError(lstrings.multisig_need_all_fields)
      return undefined
    }
    if (cosignerValues.some(value => value.length === 0)) {
      showError(lstrings.multisig_need_all_fields)
      return undefined
    }
    return { m, n }
  }

  const handleCreate = useHandler(
    async (invite: {
      mode: InviteMode
      cosignerValues: string[]
      cosignerNip05s?: Array<string | undefined>
    }) => {
      const counts = parseCounts()
      if (counts == null) return
      const { m, n } = counts

      setBusy(true)
      try {
        await dispatch(
          startMultisigWallet({
            walletType: createItem.walletType,
            keyOptions: createItem.keyOptions,
            walletName,
            requiredSignatures: m,
            totalCosigners: n,
            mode: invite.mode,
            cosignerValues: invite.cosignerValues,
            cosignerNip05s: invite.cosignerNip05s
          })
        )
        showToast(
          invite.mode === 'npub'
            ? lstrings.multisig_invites_sent
            : lstrings.multisig_complete_toast
        )
        navigation.navigate('edgeTabs', {
          screen: 'walletsTab',
          params: { screen: 'walletList' }
        })
      } catch (error: unknown) {
        showError(error)
      } finally {
        setBusy(false)
      }
    }
  )

  const handleNext = useHandler(async () => {
    const counts = parseCounts()
    if (counts == null) return

    if (ENABLE_MULTISIG_XPUB_INVITE && mode === 'xpub') {
      if (cosignerValues.some(value => !isXpubLike(value))) {
        showError(lstrings.multisig_invalid_xpub)
        return
      }
      await handleCreate({ mode: 'xpub', cosignerValues })
      return
    }

    setBusy(true)
    try {
      const resolved: ResolvedCosigner[] = []
      for (const value of cosignerValues) {
        try {
          const next = await resolveCosignerNostrInput(value)
          resolved.push({ input: value, ...next })
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          if (message === 'NIP05_NOT_FOUND') {
            showError(lstrings.multisig_nip05_not_found)
          } else {
            showError(lstrings.multisig_invalid_npub_or_nip05)
          }
          return
        }
      }

      const npubs = resolved.map(item => item.npub)
      if (npub !== '' && npubs.includes(npub)) {
        showError(lstrings.multisig_duplicate_cosigner)
        return
      }
      if (new Set(npubs).size !== npubs.length) {
        showError(lstrings.multisig_duplicate_cosigner)
        return
      }

      await fetchNostrProfiles(npubs).catch(() => {})
      setResolvedCosigners(resolved)
      setStep('review')
    } finally {
      setBusy(false)
    }
  })

  const handleConfirm = useHandler(async (resetSlider: () => void) => {
    const counts = parseCounts()
    if (counts == null) {
      resetSlider()
      return
    }
    setBusy(true)
    try {
      await dispatch(
        startMultisigWallet({
          walletType: createItem.walletType,
          keyOptions: createItem.keyOptions,
          walletName,
          requiredSignatures: counts.m,
          totalCosigners: counts.n,
          mode: 'npub',
          cosignerValues: resolvedCosigners.map(item => item.npub),
          cosignerNip05s: resolvedCosigners.map(
            item => item.nip05 ?? getCachedNostrProfile(item.npub)?.nip05
          )
        })
      )
      showToast(lstrings.multisig_invites_sent)
      navigation.navigate('edgeTabs', {
        screen: 'walletsTab',
        params: { screen: 'walletList' }
      })
    } catch (error: unknown) {
      showError(error)
      resetSlider()
    } finally {
      setBusy(false)
    }
  })

  if (step === 'review') {
    return (
      <SceneWrapper scroll>
        <SceneHeader title={lstrings.multisig_review_title} underline />
        <Space horizontalRem={0.5} bottomRem={1}>
          <Paragraph>{lstrings.multisig_review_body}</Paragraph>
          <EdgeCard>
            {resolvedCosigners.map((item, index) => {
              const profile = getCachedNostrProfile(item.npub)
              const nip05 =
                item.nip05 ??
                (profile?.nip05 != null && profile.nip05 !== ''
                  ? profile.nip05
                  : undefined)
              const title =
                nip05 != null
                  ? formatNip05Display(nip05)
                  : sprintf(
                      lstrings.multisig_cosigner_status_s,
                      String(index + 1)
                    )
              return (
                <EdgeRow
                  key={`${item.npub}-${index}`}
                  title={title}
                  body={item.npub}
                  maximumHeight="large"
                />
              )
            })}
          </EdgeCard>
          <View style={styles.slider}>
            <SafeSlider
              disabled={busy}
              confirmText={lstrings.multisig_invite_cosigners}
              onSlidingComplete={handleConfirm}
            />
          </View>
          <ButtonsView
            secondary={{
              label: lstrings.multisig_edit_cosigners,
              onPress: () => {
                setStep('form')
              },
              disabled: busy
            }}
            parentType="scene"
          />
        </Space>
      </SceneWrapper>
    )
  }

  return (
    <SceneWrapper scroll>
      <SceneHeader title={lstrings.multisig_scene_title} underline />
      <Space horizontalRem={0.5} bottomRem={1}>
        <Paragraph>{lstrings.multisig_scene_body}</Paragraph>
        <EdgeCard>
          {npub !== '' && hasNostrFriendlyLabel(npub) ? (
            <EdgeRow
              title={lstrings.nostr_account_display_name}
              body={ownLabel}
              maximumHeight="large"
            />
          ) : null}
          <EdgeRow
            title={lstrings.multisig_your_npub}
            body={npub === '' ? '…' : npub}
            rightButtonType="copy"
            maximumHeight="large"
          />
          <Paragraph marginRem={[0.5, 0.5, 0.25, 0.5]}>
            {lstrings.multisig_your_npub_body}
          </Paragraph>
        </EdgeCard>

        <FilledTextInput
          topRem={1}
          value={totalCosigners}
          onChangeText={handleTotalChange}
          placeholder={lstrings.multisig_cosigners_title}
          numeric
          autoCorrect={false}
          returnKeyType="next"
        />
        <FilledTextInput
          topRem={1}
          value={requiredSignatures}
          onChangeText={handleRequiredChange}
          placeholder={lstrings.multisig_signatures_title}
          numeric
          autoCorrect={false}
          returnKeyType="next"
        />

        {ENABLE_MULTISIG_XPUB_INVITE ? (
          <EdgeCard>
            <SettingsRadioRow
              label={lstrings.multisig_mode_npub}
              value={mode === 'npub'}
              onPress={() => {
                setMode('npub')
              }}
            />
            <SettingsRadioRow
              label={lstrings.multisig_mode_xpub}
              value={mode === 'xpub'}
              onPress={() => {
                setMode('xpub')
              }}
            />
          </EdgeCard>
        ) : null}

        <View style={styles.fields}>
          {cosignerValues.map((value, index) =>
            ENABLE_MULTISIG_XPUB_INVITE && mode === 'xpub' ? (
              <FilledTextInput
                key={`cosigner-${index}`}
                topRem={1}
                value={value}
                onChangeText={text => {
                  handleCosignerChange(index, text)
                }}
                placeholder={sprintf(
                  lstrings.multisig_cosigner_xpub_s,
                  String(index + 1)
                )}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            ) : (
              <CosignerNpubField
                key={`cosigner-${index}`}
                index={index}
                value={value}
                onChangeText={text => {
                  handleCosignerChange(index, text)
                }}
              />
            )
          )}
        </View>

        <ButtonsView
          primary={{
            label: lstrings.string_next_capitalized,
            onPress: handleNext,
            disabled: busy,
            spinner: busy
          }}
          parentType="scene"
        />
      </Space>
    </SceneWrapper>
  )
}

const getStyles = cacheStyles((theme: Theme) => ({
  fields: {
    marginTop: theme.rem(0.5)
  },
  slider: {
    alignItems: 'center',
    marginTop: theme.rem(1)
  },
  hint: {
    color: theme.secondaryText,
    fontSize: theme.rem(0.75),
    marginTop: theme.rem(0.25),
    marginHorizontal: theme.rem(0.5)
  }
}))
