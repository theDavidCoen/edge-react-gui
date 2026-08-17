import * as React from 'react'
import { ActivityIndicator, View } from 'react-native'
import { sprintf } from 'sprintf-js'

import {
  acceptMultisigInvite,
  declineMultisigInvite,
  pollMultisigInbox
} from '../../actions/MultisigActions'
import { useAsyncEffect } from '../../hooks/useAsyncEffect'
import { useHandler } from '../../hooks/useHandler'
import { useMount } from '../../hooks/useMount'
import { lstrings } from '../../locales/strings'
import { useDispatch, useSelector } from '../../types/reactRedux'
import type { EdgeAppSceneProps } from '../../types/routerTypes'
import { resolveStoredJoinableProposalId } from '../../util/multisig/inviteResolve'
import {
  getMultisigProposal,
  loadMultisigStore,
  upsertMultisigProposal,
  useMultisigProposals
} from '../../util/multisig/store'
import {
  hasLocalJoinedProposal,
  type MultisigCosigner,
  npubsEqual,
  pendingCount,
  withLocalCosignerAccepted
} from '../../util/multisig/types'
import { ensureNostrIdentity } from '../../util/nostr/identity'
import {
  fetchNostrProfiles,
  formatNip05Display
} from '../../util/nostr/profile'
import { ButtonsView } from '../buttons/ButtonsView'
import { EdgeCard } from '../cards/EdgeCard'
import { EdgeTouchableOpacity } from '../common/EdgeTouchableOpacity'
import { SceneWrapper } from '../common/SceneWrapper'
import { DeleteIcon } from '../icons/ThemedIcons'
import { Space } from '../layout/Space'
import { ButtonsModal } from '../modals/ButtonsModal'
import { EdgeRow } from '../rows/EdgeRow'
import { Airship, showError, showToast } from '../services/AirshipInstance'
import { cacheStyles, type Theme, useTheme } from '../services/ThemeContext'
import { EdgeText, Paragraph } from '../themed/EdgeText'
import { useResolvedNostrLabel } from '../themed/NostrNpubLabel'
import { SafeSlider } from '../themed/SafeSlider'
import { SceneHeader } from '../themed/SceneHeader'

export interface MultisigPendingParams {
  proposalId: string
}

interface Props extends EdgeAppSceneProps<'multisigPending'> {}

interface CosignerPendingRowProps {
  cosigner: MultisigCosigner
  index: number
  isYou: boolean
  needsJoin: boolean
  onReject: () => void
}

const CosignerPendingRow: React.FC<CosignerPendingRowProps> = props => {
  const { cosigner, index, isYou, needsJoin, onReject } = props
  const theme = useTheme()
  const styles = getStyles(theme)
  const identityLabel = useResolvedNostrLabel(
    cosigner.npub,
    cosigner.xpub != null
      ? `${cosigner.xpub.slice(0, 12)}…`
      : lstrings.multisig_cosigner_unknown
  )
  const nip05Label =
    cosigner.nip05 != null && cosigner.nip05.trim() !== ''
      ? formatNip05Display(cosigner.nip05)
      : undefined
  const statusLabel =
    cosigner.status === 'pending'
      ? lstrings.multisig_cosigner_pending
      : lstrings.multisig_cosigner_accepted
  const title = isYou
    ? lstrings.multisig_cosigner_you
    : sprintf(lstrings.multisig_cosigner_status_s, String(index + 1))
  const body =
    nip05Label != null && cosigner.npub != null
      ? `${statusLabel} · ${nip05Label}\n${cosigner.npub}`
      : `${statusLabel} · ${identityLabel}`
  const showReject = isYou && needsJoin

  if (showReject) {
    return (
      <View style={styles.youRow}>
        <View style={styles.youContent}>
          <EdgeText style={styles.youTitle}>{title}</EdgeText>
          <EdgeText style={styles.youBody} numberOfLines={0}>
            {body}
          </EdgeText>
        </View>
        <EdgeTouchableOpacity
          accessible
          accessibilityLabel={lstrings.multisig_reject_invite}
          onPress={onReject}
          style={styles.rejectHit}
        >
          <DeleteIcon style={styles.rejectIcon} size={theme.rem(1.25)} />
        </EdgeTouchableOpacity>
      </View>
    )
  }

  return <EdgeRow title={title} body={body} maximumHeight="large" />
}

const MultisigPendingComponent: React.FC<Props> = props => {
  const { navigation, route } = props
  const { proposalId } = route.params
  const dispatch = useDispatch()
  const theme = useTheme()
  const styles = getStyles(theme)
  const account = useSelector(state => state.core.account)
  const accountId = account.id
  const proposals = useMultisigProposals()
  const [ready, setReady] = React.useState(
    () =>
      getMultisigProposal(proposalId) != null ||
      resolveStoredJoinableProposalId(proposalId) != null
  )
  const [localNpub, setLocalNpub] = React.useState('')
  const [hasJoined, setHasJoined] = React.useState(false)

  useMount(() => {
    ensureNostrIdentity(account)
      .then(identity => {
        setLocalNpub(identity.npub)
      })
      .catch(() => {})
  })

  React.useEffect(() => {
    setHasJoined(false)
  }, [proposalId])

  // Paint cached invite immediately; refresh accepts in the background.
  useAsyncEffect(
    async () => {
      await loadMultisigStore(account)
      setReady(true)
      dispatch(pollMultisigInbox(1200)).catch(() => {})
    },
    [accountId, proposalId, dispatch],
    'MultisigPendingScene'
  )

  const activeProposalId =
    resolveStoredJoinableProposalId(proposalId) ?? proposalId
  const proposal =
    proposals.find(item => item.id === activeProposalId) ??
    getMultisigProposal(activeProposalId)

  useAsyncEffect(
    async () => {
      if (proposal == null || localNpub === '') return
      const repaired = withLocalCosignerAccepted(proposal, localNpub)
      if (repaired === proposal) return
      await upsertMultisigProposal(account, repaired)
    },
    [account, localNpub, proposal],
    'MultisigPendingScene:repairLocal'
  )

  useAsyncEffect(
    async () => {
      if (!ready || proposal == null || proposal.status !== 'pending') return
      let cancelled = false
      const timer = setInterval(() => {
        if (cancelled) return
        dispatch(pollMultisigInbox(1200)).catch(() => {})
      }, 8000)
      return () => {
        cancelled = true
        clearInterval(timer)
      }
    },
    [ready, proposal?.id, proposal?.status, dispatch],
    'MultisigPendingScene:poll'
  )

  const bitcoinConfig = account.currencyConfig.bitcoin
  const walletType = bitcoinConfig?.currencyInfo.walletType ?? 'wallet:bitcoin'

  const handleJoin = useHandler(async (resetSlider: () => void) => {
    if (proposal == null) {
      resetSlider()
      return
    }
    try {
      const joined = await dispatch(
        acceptMultisigInvite({
          proposalId: proposal.id,
          walletType,
          keyOptions: { format: 'bip49' }
        })
      )
      setHasJoined(true)
      showToast(
        joined.status === 'complete'
          ? lstrings.multisig_complete_toast
          : lstrings.multisig_joined_waiting
      )
      navigation.navigate('edgeTabs', {
        screen: 'walletsTab',
        params: { screen: 'walletList' }
      })
    } catch (error: unknown) {
      showError(error)
      resetSlider()
    }
  })

  const handleReject = useHandler(async () => {
    if (proposal == null) return
    const result = await Airship.show<'confirm' | 'cancel' | undefined>(
      bridge => (
        <ButtonsModal
          bridge={bridge}
          title={lstrings.multisig_reject_invite}
          message={lstrings.multisig_reject_invite_body}
          warning
          buttons={{
            confirm: { label: lstrings.multisig_reject_invite_confirm },
            cancel: { label: lstrings.string_cancel_cap }
          }}
        />
      )
    )
    if (result !== 'confirm') return
    try {
      await dispatch(declineMultisigInvite(proposal.id))
      showToast(lstrings.multisig_reject_invite_toast)
      navigation.navigate('edgeTabs', {
        screen: 'walletsTab',
        params: { screen: 'walletList' }
      })
    } catch (error: unknown) {
      showError(error)
    }
  })

  const handleRefresh = useHandler(async () => {
    try {
      await dispatch(pollMultisigInbox())
      await loadMultisigStore(account)
      if (
        resolveStoredJoinableProposalId(proposalId) != null ||
        getMultisigProposal(proposalId) != null
      ) {
        showToast(lstrings.multisig_invite_title)
      } else {
        showToast(lstrings.multisig_invite_missing)
      }
    } catch (error: unknown) {
      showError(error)
    }
  })

  if (!ready) {
    return (
      <SceneWrapper>
        <SceneHeader title={lstrings.multisig_pending_title} underline />
        <View style={styles.loading}>
          <ActivityIndicator color={theme.primaryText} size="large" />
        </View>
      </SceneWrapper>
    )
  }

  if (proposal == null || proposal.status === 'declined') {
    return (
      <SceneWrapper>
        <SceneHeader title={lstrings.multisig_pending_title} underline />
        <Space horizontalRem={0.5}>
          <Paragraph>{lstrings.multisig_invite_missing}</Paragraph>
          <ButtonsView
            secondary={{
              label: lstrings.multisig_invite_retry,
              onPress: handleRefresh
            }}
            tertiary={{
              label: lstrings.string_done_cap,
              onPress: () => {
                navigation.pop()
              }
            }}
            parentType="scene"
          />
        </Space>
      </SceneWrapper>
    )
  }

  return (
    <MultisigPendingContent
      proposal={proposal}
      localNpub={localNpub}
      hasJoined={hasJoined}
      navigation={navigation}
      onJoin={handleJoin}
      onReject={handleReject}
    />
  )
}

interface MultisigPendingContentProps {
  proposal: NonNullable<ReturnType<typeof getMultisigProposal>>
  localNpub: string
  hasJoined: boolean
  navigation: Props['navigation']
  onJoin: (resetSlider: () => void) => Promise<void>
  onReject: () => Promise<void>
}

const MultisigPendingContent: React.FC<MultisigPendingContentProps> = props => {
  const { proposal, localNpub, hasJoined, navigation, onJoin, onReject } = props
  const theme = useTheme()
  const styles = getStyles(theme)
  const confirmed = pendingCount(proposal)
  const needsJoin =
    proposal.role === 'cosigner' &&
    proposal.status === 'pending' &&
    !hasJoined &&
    !hasLocalJoinedProposal(proposal, localNpub)
  const initiatorLabel = useResolvedNostrLabel(proposal.initiatorNpub)

  React.useEffect(() => {
    const npubs = [
      proposal.initiatorNpub,
      ...proposal.cosigners
        .map(c => c.npub)
        .filter((n): n is string => n != null)
    ]
    fetchNostrProfiles(npubs).catch(() => {})
  }, [proposal])

  return (
    <SceneWrapper scroll>
      <SceneHeader
        title={
          needsJoin
            ? lstrings.multisig_invite_title
            : lstrings.multisig_pending_title
        }
        underline
      />
      <Space horizontalRem={0.5} bottomRem={1}>
        <Paragraph>
          {needsJoin
            ? sprintf(
                lstrings.multisig_invite_body_s,
                initiatorLabel,
                String(proposal.requiredSignatures),
                String(proposal.totalCosigners)
              )
            : sprintf(
                lstrings.multisig_pending_progress_s,
                String(confirmed),
                String(proposal.totalCosigners)
              )}
        </Paragraph>

        <EdgeCard>
          <EdgeRow
            title={lstrings.multisig_wallet_name}
            body={proposal.walletName}
          />
          <EdgeRow
            title={lstrings.multisig_threshold}
            body={`${proposal.requiredSignatures}-of-${proposal.totalCosigners}`}
          />
          <EdgeRow
            title={lstrings.multisig_status}
            body={
              proposal.status === 'complete'
                ? lstrings.multisig_status_complete
                : lstrings.multisig_pending_title
            }
          />
        </EdgeCard>

        {proposal.p2wshAddress != null ? (
          <EdgeCard>
            <EdgeRow
              title={lstrings.multisig_onchain_address}
              body={proposal.p2wshAddress}
              rightButtonType="copy"
              maximumHeight="large"
            />
          </EdgeCard>
        ) : null}

        <EdgeCard>
          {proposal.cosigners.map((cosigner, index) => {
            const isYou = npubsEqual(cosigner.npub, localNpub)
            return (
              <CosignerPendingRow
                key={`${cosigner.npub ?? cosigner.xpub ?? index}`}
                cosigner={cosigner}
                index={index}
                isYou={isYou}
                needsJoin={needsJoin}
                onReject={() => {
                  onReject().catch(() => {})
                }}
              />
            )
          })}
        </EdgeCard>

        {needsJoin ? (
          <View style={styles.slider}>
            <SafeSlider
              disabled={false}
              confirmText={lstrings.multisig_invite_confirm}
              onSlidingComplete={onJoin}
            />
          </View>
        ) : (
          <ButtonsView
            secondary={{
              label: lstrings.string_done_cap,
              onPress: () => {
                navigation.pop()
              }
            }}
            parentType="scene"
          />
        )}
      </Space>
    </SceneWrapper>
  )
}

export const MultisigPendingScene = React.memo(MultisigPendingComponent)

const getStyles = cacheStyles((theme: Theme) => ({
  slider: {
    alignItems: 'center',
    marginTop: theme.rem(1)
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.rem(2)
  },
  youRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.rem(0.5),
    paddingHorizontal: theme.rem(0.5)
  },
  youContent: {
    flex: 1,
    flexShrink: 1,
    marginRight: theme.rem(0.5)
  },
  youTitle: {
    color: theme.secondaryText,
    fontSize: theme.rem(0.75),
    marginBottom: theme.rem(0.25)
  },
  youBody: {
    color: theme.primaryText,
    fontSize: theme.rem(0.875)
  },
  rejectHit: {
    padding: theme.rem(0.5)
  },
  rejectIcon: {
    color: theme.dangerIcon
  }
}))
