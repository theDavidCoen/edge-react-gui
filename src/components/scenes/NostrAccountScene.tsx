import * as React from 'react'

import { validatePassword } from '../../actions/AccountActions'
import { useHandler } from '../../hooks/useHandler'
import { lstrings } from '../../locales/strings'
import { useDispatch, useSelector } from '../../types/reactRedux'
import type { EdgeAppSceneProps } from '../../types/routerTypes'
import { useMultisigIdentity } from '../../util/multisig/store'
import {
  encodeNsec,
  hexToBytes,
  isValidNsec
} from '../../util/nostr/bech32Keys'
import {
  ensureNostrIdentity,
  importNostrIdentity
} from '../../util/nostr/identity'
import {
  formatNip05Display,
  getCachedNostrProfile,
  publishNostrDisplayName,
  refreshOwnNostrProfile,
  seedProfileFromIdentity,
  useNostrProfilesVersion
} from '../../util/nostr/profile'
import { EdgeButton } from '../buttons/EdgeButton'
import { EdgeCard } from '../cards/EdgeCard'
import { SceneWrapper } from '../common/SceneWrapper'
import { Space } from '../layout/Space'
import { ButtonsModal } from '../modals/ButtonsModal'
import { ConfirmContinueModal } from '../modals/ConfirmContinueModal'
import { TextInputModal } from '../modals/TextInputModal'
import { EdgeRow } from '../rows/EdgeRow'
import { Airship, showError, showToast } from '../services/AirshipInstance'
import { cacheStyles, type Theme, useTheme } from '../services/ThemeContext'
import { Paragraph } from '../themed/EdgeText'

interface Props extends EdgeAppSceneProps<'nostrAccount'> {}

export const NostrAccountScene: React.FC<Props> = () => {
  const theme = useTheme()
  const styles = getStyles(theme)
  const dispatch = useDispatch()
  const account = useSelector(state => state.core.account)
  const identity = useMultisigIdentity()
  const profilesVersion = useNostrProfilesVersion()

  const [busy, setBusy] = React.useState(false)
  const [loadingProfile, setLoadingProfile] = React.useState(true)

  const npub = identity?.npub ?? ''

  React.useEffect(() => {
    let cancelled = false
    setLoadingProfile(true)
    ensureNostrIdentity(account)
      .then(async id => {
        if (cancelled) return
        seedProfileFromIdentity(id)
        await refreshOwnNostrProfile(account)
      })
      .catch((error: unknown) => {
        if (!cancelled) showError(error)
      })
      .finally(() => {
        if (!cancelled) setLoadingProfile(false)
      })
    return () => {
      cancelled = true
    }
  }, [account, npub])

  const profile =
    profilesVersion >= 0 && npub !== ''
      ? getCachedNostrProfile(npub)
      : undefined

  const displayName = profile?.displayName ?? profile?.name ?? ''
  const nip05 =
    profile?.nip05 != null && profile.nip05 !== ''
      ? formatNip05Display(profile.nip05)
      : ''

  const handleSetDisplayName = useHandler(async () => {
    const suggested =
      displayName !== ''
        ? displayName
        : account.username != null && account.username !== ''
        ? account.username
        : ''
    const value = await Airship.show<string | undefined>(inputBridge => (
      <TextInputModal
        bridge={inputBridge}
        title={lstrings.nostr_account_set_display_name_title}
        message={lstrings.nostr_account_set_display_name_body}
        inputLabel={lstrings.nostr_account_display_name}
        initialValue={suggested}
        autoCapitalize="words"
        autoCorrect
        submitLabel={lstrings.save}
      />
    ))
    if (value == null || value.trim() === '') return
    setBusy(true)
    try {
      await publishNostrDisplayName(account, value)
      showToast(lstrings.nostr_account_display_name_saved)
    } catch (error: unknown) {
      showError(error)
    } finally {
      setBusy(false)
    }
  })

  const handleRevealPrivateKey = useHandler(async () => {
    setBusy(true)
    try {
      const passwordValid =
        (await dispatch(
          validatePassword({
            title: lstrings.nostr_account_private_key_title,
            submitLabel: lstrings.nostr_account_private_key_button,
            warningMessage: lstrings.nostr_account_private_key_warning
          })
        )) != null

      if (!passwordValid) return

      const current = await ensureNostrIdentity(account)
      const nsec = encodeNsec(hexToBytes(current.nsecHex))

      await Airship.show<'ok' | undefined>(innerBridge => (
        <ButtonsModal
          bridge={innerBridge}
          title={lstrings.nostr_account_private_key_title}
          message={nsec}
          buttons={{ ok: { label: lstrings.string_ok_cap } }}
        />
      ))
    } finally {
      setBusy(false)
    }
  })

  const handleImport = useHandler(async () => {
    const confirmed = await Airship.show<boolean>(bridge => (
      <ConfirmContinueModal
        bridge={bridge}
        title={lstrings.nostr_account_import_title}
        body={lstrings.nostr_account_import_warning}
        warning
        onPress={async () => true}
      />
    ))
    if (!confirmed) return

    const passwordValid =
      (await dispatch(
        validatePassword({
          title: lstrings.nostr_account_import_title,
          submitLabel: lstrings.nostr_account_import_button,
          warningMessage: lstrings.nostr_account_import_warning
        })
      )) != null
    if (!passwordValid) return

    const nsec = await Airship.show<string | undefined>(inputBridge => (
      <TextInputModal
        bridge={inputBridge}
        title={lstrings.nostr_account_import_title}
        message={lstrings.nostr_account_import_body}
        inputLabel={lstrings.nostr_account_import_nsec_label}
        autoCapitalize="none"
        autoCorrect={false}
        submitLabel={lstrings.nostr_account_import_button}
      />
    ))
    if (nsec == null || nsec.trim() === '') return
    if (!isValidNsec(nsec)) {
      showError(lstrings.nostr_account_import_invalid)
      return
    }

    setBusy(true)
    try {
      const imported = await importNostrIdentity(account, nsec)
      seedProfileFromIdentity(imported)
      await refreshOwnNostrProfile(account)
      showToast(lstrings.nostr_account_import_success)
    } catch (error: unknown) {
      showError(error)
    } finally {
      setBusy(false)
    }
  })

  return (
    <SceneWrapper scroll>
      <Space horizontalRem={0.5} bottomRem={1} topRem={0.5}>
        <Paragraph style={styles.body}>
          {lstrings.nostr_account_npub_body}
        </Paragraph>
        <EdgeCard>
          <EdgeRow
            title={lstrings.multisig_your_npub}
            body={npub === '' ? '…' : npub}
            rightButtonType="copy"
            maximumHeight="large"
          />
          <EdgeRow
            title={lstrings.nostr_account_display_name}
            body={
              loadingProfile
                ? '…'
                : displayName !== ''
                ? displayName
                : lstrings.nostr_account_display_name_none
            }
            rightButtonType="editable"
            onPress={busy || loadingProfile ? undefined : handleSetDisplayName}
            maximumHeight="large"
          />
          <EdgeRow
            title={lstrings.nostr_account_nip05}
            body={
              loadingProfile
                ? '…'
                : nip05 !== ''
                ? nip05
                : lstrings.nostr_account_nip05_none
            }
            maximumHeight="large"
          />
        </EdgeCard>

        <Paragraph marginRem={[1, 0, 0.5, 0]}>
          {lstrings.nostr_account_import_body}
        </Paragraph>
        <EdgeButton
          type="secondary"
          label={lstrings.nostr_account_import_button}
          disabled={busy || loadingProfile}
          onPress={handleImport}
        />
        <EdgeButton
          type="primary"
          label={lstrings.nostr_account_private_key_button}
          disabled={busy}
          onPress={handleRevealPrivateKey}
        />
      </Space>
    </SceneWrapper>
  )
}

const getStyles = cacheStyles((theme: Theme) => ({
  body: {
    marginBottom: theme.rem(0.5)
  }
}))
