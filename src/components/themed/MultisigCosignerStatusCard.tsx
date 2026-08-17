import * as React from 'react'
import { View } from 'react-native'
import { sprintf } from 'sprintf-js'

import { useHandler } from '../../hooks/useHandler'
import { lstrings } from '../../locales/strings'
import type { NavigationBase } from '../../types/routerTypes'
import {
  useMultisigIdentity,
  useMultisigProposals
} from '../../util/multisig/store'
import {
  isWalletWaitingCosigners,
  type MultisigCosigner,
  type MultisigProposal,
  npubsEqual
} from '../../util/multisig/types'
import { formatNip05Display } from '../../util/nostr/profile'
import { EdgeCard } from '../cards/EdgeCard'
import { EdgeTouchableOpacity } from '../common/EdgeTouchableOpacity'
import { EdgeRow } from '../rows/EdgeRow'
import { cacheStyles, type Theme, useTheme } from '../services/ThemeContext'
import { EdgeText } from '../themed/EdgeText'
import { useResolvedNostrLabel } from './NostrNpubLabel'

interface Props {
  walletId: string
  navigation?: NavigationBase
}

interface CosignerRowProps {
  cosigner: MultisigCosigner
  index: number
  isYou: boolean
}

const CosignerStatusRow: React.FC<CosignerRowProps> = props => {
  const { cosigner, index, isYou } = props
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

  return (
    <EdgeRow
      title={
        isYou
          ? lstrings.multisig_cosigner_you
          : sprintf(lstrings.multisig_cosigner_status_s, String(index + 1))
      }
      body={
        nip05Label != null && cosigner.npub != null
          ? `${nip05Label}\n${cosigner.npub}\n${statusLabel}`
          : `${identityLabel} · ${statusLabel}`
      }
      maximumHeight="large"
    />
  )
}

export const MultisigCosignerStatusCard: React.FC<Props> = props => {
  const { walletId, navigation } = props
  const theme = useTheme()
  const styles = getStyles(theme)
  const proposals = useMultisigProposals()
  const identity = useMultisigIdentity()
  const proposal = isWalletWaitingCosigners(proposals, walletId)
    ? proposals.find(
        item => item.walletId === walletId && item.status === 'pending'
      )
    : undefined

  const handleOpenPending = useHandler(() => {
    if (proposal == null || navigation == null) return
    navigation.navigate('multisigPending', { proposalId: proposal.id })
  })

  if (proposal == null) return null

  return (
    <EdgeTouchableOpacity onPress={handleOpenPending}>
      <EdgeCard marginRem={[0.5, 0.5, 0, 0.5]}>
        <EdgeText style={styles.title}>
          {lstrings.multisig_waiting_cosigners}
        </EdgeText>
        <EdgeText style={styles.subtitle}>
          {sprintf(
            lstrings.multisig_pending_progress_s,
            String(
              proposal.cosigners.filter(
                c => c.status === 'accepted' || c.status === 'local'
              ).length
            ),
            String(proposal.totalCosigners)
          )}
        </EdgeText>
        <View style={styles.rows}>
          {proposal.cosigners.map((cosigner, index) => {
            const isYou = npubsEqual(cosigner.npub, identity?.npub)
            return (
              <CosignerStatusRow
                key={`${cosigner.npub ?? cosigner.xpub ?? index}`}
                cosigner={cosigner}
                index={index}
                isYou={isYou}
              />
            )
          })}
        </View>
      </EdgeCard>
    </EdgeTouchableOpacity>
  )
}

export const usePendingMultisigProposal = (
  walletId: string
): MultisigProposal | undefined => {
  const proposals = useMultisigProposals()
  return isWalletWaitingCosigners(proposals, walletId)
    ? proposals.find(
        item => item.walletId === walletId && item.status === 'pending'
      )
    : undefined
}

const getStyles = cacheStyles((theme: Theme) => ({
  title: {
    fontFamily: theme.fontFaceMedium,
    marginBottom: theme.rem(0.25)
  },
  subtitle: {
    color: theme.secondaryText,
    fontSize: theme.rem(0.75),
    marginBottom: theme.rem(0.5)
  },
  rows: {
    gap: theme.rem(0)
  }
}))
