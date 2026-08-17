import * as React from 'react'
import { ActivityIndicator, View } from 'react-native'
import { sprintf } from 'sprintf-js'

import {
  approveMultisigSpend,
  rejectMultisigSpend
} from '../../actions/MultisigActions'
import { useAsyncEffect } from '../../hooks/useAsyncEffect'
import { useHandler } from '../../hooks/useHandler'
import { lstrings } from '../../locales/strings'
import { useDispatch, useSelector } from '../../types/reactRedux'
import type { EdgeAppSceneProps } from '../../types/routerTypes'
import {
  getMultisigSpend,
  loadMultisigStore,
  useMultisigSpends
} from '../../util/multisig/store'
import { spendSignedCount } from '../../util/multisig/types'
import { ButtonsView } from '../buttons/ButtonsView'
import { EdgeCard } from '../cards/EdgeCard'
import { SceneWrapper } from '../common/SceneWrapper'
import { Space } from '../layout/Space'
import { ButtonsModal } from '../modals/ButtonsModal'
import { EdgeRow } from '../rows/EdgeRow'
import { Airship, showError, showToast } from '../services/AirshipInstance'
import { cacheStyles, type Theme, useTheme } from '../services/ThemeContext'
import { Paragraph } from '../themed/EdgeText'
import { useResolvedNostrLabel } from '../themed/NostrNpubLabel'
import { SafeSlider } from '../themed/SafeSlider'
import { SceneHeader } from '../themed/SceneHeader'

export interface MultisigSpendPendingParams {
  spendId: string
}

interface Props extends EdgeAppSceneProps<'multisigSpendPending'> {}

interface SignerRowProps {
  npub: string
  status: string
  index: number
  isYou: boolean
}

const SignerRow: React.FC<SignerRowProps> = props => {
  const { npub, status, index, isYou } = props
  const label = useResolvedNostrLabel(npub)
  const statusLabel =
    status === 'signed'
      ? lstrings.multisig_spend_status_signed
      : status === 'rejected'
      ? lstrings.multisig_spend_status_rejected
      : lstrings.multisig_spend_status_pending
  return (
    <EdgeRow
      title={
        isYou
          ? lstrings.multisig_cosigner_you
          : sprintf(lstrings.multisig_cosigner_status_s, String(index + 1))
      }
      body={`${label} · ${statusLabel}`}
      maximumHeight="large"
    />
  )
}

export const MultisigSpendPendingScene: React.FC<Props> = props => {
  const { navigation, route } = props
  const { spendId } = route.params
  const dispatch = useDispatch()
  const theme = useTheme()
  const styles = getStyles(theme)
  const account = useSelector(state => state.core.account)
  const spends = useMultisigSpends()
  const [ready, setReady] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [localNpub, setLocalNpub] = React.useState('')

  useAsyncEffect(
    async () => {
      await loadMultisigStore(account)
      const { ensureNostrIdentity } = await import('../../util/nostr/identity')
      const identity = await ensureNostrIdentity(account)
      setLocalNpub(identity.npub)
      setReady(true)
    },
    [account],
    'MultisigSpendPendingScene'
  )

  const spend =
    spends.find(item => item.id === spendId) ?? getMultisigSpend(spendId)

  const goBackToWallet = useHandler(() => {
    if (spend?.walletId != null) {
      navigation.navigate('edgeTabs', {
        screen: 'walletsTab',
        params: {
          screen: 'walletDetails',
          params: { walletId: spend.walletId, tokenId: null }
        }
      })
      return
    }
    navigation.pop()
  })

  const handleApprove = useHandler(async (resetSlider: () => void) => {
    if (spend == null) {
      resetSlider()
      return
    }
    setBusy(true)
    try {
      // No password — account is unlocked; slider is the confirmation.
      const walletId = spend.walletId
      if (walletId == null) {
        throw new Error('Wallet missing for spend')
      }
      const privateKeyMaterial = await account.getDisplayPrivateKey(walletId)
      const updated = await dispatch(
        approveMultisigSpend({
          spendId: spend.id,
          privateKeyMaterial
        })
      )
      if (updated.status === 'broadcast') {
        // Cosigner who broadcasts gets brief confirmation; initiator is not
        // toasted again when the Nostr spend-complete arrives.
        showToast(lstrings.multisig_spend_broadcast_toast)
        goBackToWallet()
      } else {
        showToast(lstrings.multisig_spend_sent_toast)
        resetSlider()
      }
    } catch (error: unknown) {
      showError(error)
      resetSlider()
    } finally {
      setBusy(false)
    }
  })

  const handleReject = useHandler(async () => {
    if (spend == null) return
    const result = await Airship.show<'confirm' | 'cancel' | undefined>(
      bridge => (
        <ButtonsModal
          bridge={bridge}
          title={lstrings.multisig_spend_reject}
          message={lstrings.multisig_spend_reject_body}
          warning
          buttons={{
            confirm: { label: lstrings.multisig_spend_reject },
            cancel: { label: lstrings.string_cancel_cap }
          }}
        />
      )
    )
    if (result !== 'confirm') return
    try {
      await dispatch(rejectMultisigSpend(spend.id))
      showToast(lstrings.multisig_spend_rejected_toast)
      navigation.pop()
    } catch (error: unknown) {
      showError(error)
    }
  })

  if (!ready && spend == null) {
    return (
      <SceneWrapper>
        <SceneHeader title={lstrings.multisig_spend_title} underline />
        <View style={styles.loading}>
          <ActivityIndicator color={theme.primaryText} size="large" />
        </View>
      </SceneWrapper>
    )
  }

  if (spend == null) {
    return (
      <SceneWrapper>
        <SceneHeader title={lstrings.multisig_spend_title} underline />
        <Space horizontalRem={0.5}>
          <Paragraph>{lstrings.multisig_spend_missing}</Paragraph>
          <ButtonsView
            secondary={{
              label: lstrings.string_done_cap,
              onPress: goBackToWallet
            }}
            parentType="scene"
          />
        </Space>
      </SceneWrapper>
    )
  }

  const signed = spendSignedCount(spend)
  const needsSign =
    spend.status === 'pending' &&
    !spend.signers.some(s => s.npub === localNpub && s.status === 'signed')
  const wouldBroadcast =
    signed + (needsSign ? 1 : 0) >= spend.requiredSignatures

  return (
    <SceneWrapper scroll>
      <SceneHeader title={lstrings.multisig_spend_title} underline />
      <Space horizontalRem={0.5} bottomRem={1}>
        <Paragraph>
          {sprintf(
            lstrings.multisig_spend_progress_s,
            String(signed),
            String(spend.requiredSignatures)
          )}
        </Paragraph>
        {spend.status === 'pending' ? (
          <Paragraph>
            {wouldBroadcast
              ? lstrings.multisig_spend_banner_broadcast
              : lstrings.multisig_spend_banner_request}
          </Paragraph>
        ) : null}

        <EdgeCard>
          <EdgeRow
            title={lstrings.multisig_spend_destination}
            body={spend.destAddress !== '' ? spend.destAddress : '—'}
            maximumHeight="large"
          />
          <EdgeRow
            title={lstrings.multisig_spend_amount}
            body={`${spend.amountNative} sats`}
          />
          <EdgeRow
            title={lstrings.multisig_spend_fee}
            body={`${spend.feeNative} sats`}
          />
          <EdgeRow
            title={lstrings.multisig_status}
            body={
              spend.status === 'broadcast'
                ? lstrings.multisig_spend_broadcast_toast
                : spend.status === 'rejected'
                ? lstrings.multisig_spend_status_rejected
                : lstrings.multisig_pending_title
            }
          />
          {spend.txid != null ? (
            <EdgeRow
              title="txid"
              body={spend.txid}
              rightButtonType="copy"
              maximumHeight="large"
            />
          ) : null}
        </EdgeCard>

        <EdgeCard>
          {spend.signers.map((signer, index) => (
            <SignerRow
              key={signer.npub}
              npub={signer.npub}
              status={signer.status}
              index={index}
              isYou={localNpub !== '' && signer.npub === localNpub}
            />
          ))}
        </EdgeCard>

        {needsSign && !busy ? (
          <View style={styles.slider}>
            <SafeSlider
              confirmText={
                wouldBroadcast
                  ? lstrings.multisig_spend_slider_broadcast
                  : lstrings.multisig_spend_approve
              }
              onSlidingComplete={handleApprove}
              disabled={false}
            />
            <ButtonsView
              secondary={{
                label: lstrings.multisig_spend_reject,
                onPress: handleReject
              }}
              parentType="scene"
            />
          </View>
        ) : (
          <ButtonsView
            secondary={{
              label: lstrings.string_done_cap,
              onPress: goBackToWallet
            }}
            parentType="scene"
          />
        )}
      </Space>
    </SceneWrapper>
  )
}

const getStyles = cacheStyles((theme: Theme) => ({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.rem(2)
  },
  slider: {
    alignItems: 'center',
    marginTop: theme.rem(1),
    gap: theme.rem(0.5)
  }
}))
